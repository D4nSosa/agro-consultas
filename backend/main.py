"""
main.py - Backend Geoespacial Python con FastAPI para el Módulo Análisis Forestal
Servicios REST para consulta STAC Copernicus, procesamiento de geometría GeoJSON, NDVI y detección de cambios.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import math
import datetime
import requests
from shapely.geometry import shape, Point, Polygon

app = FastAPI(
    title="Agro Consultas - API Geoespacial Forestal",
    description="API REST para procesamiento de teledetección, catálogo Copernicus STAC, NDVI y detección multitemporal de cambios.",
    version="1.0.0"
)

# Permitir CORS para integración con el frontend de Agro Consultas
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COPERNICUS_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search"

# Modelos Pydantic
class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: Any

class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: GeoJSONGeometry
    properties: Optional[Dict[str, Any]] = {}

class STACSearchRequest(BaseModel):
    geometry: GeoJSONGeometry
    startDate: str = "2025-01-01"
    endDate: str = "2026-08-15"
    maxCloudCover: float = 30.0

class NDVIAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    date: str = "2026-08-15"
    productId: Optional[str] = "S2A_MSIL2A_LOCAL"

class ChangeDetectionRequest(BaseModel):
    geometry: GeoJSONGeometry
    dateA: str = "2025-08-15"
    dateB: str = "2026-08-15"

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Agro Consultas Geospatial Forest API",
        "version": "1.0.0",
        "copernicusCatalog": "https://stac.dataspace.copernicus.eu/v1/",
        "endpoints": [
            "/api/forest/lots",
            "/api/forest/stac",
            "/api/forest/ndvi",
            "/api/forest/changes",
            "/api/forest/analyze"
        ]
    }

@app.get("/api/forest/lots")
def get_sample_lots():
    """Retorna listado de lotes forestales de ejemplo (diseño preparado para futuro PostGIS)"""
    return [
        {
            "id": "lote-misiones-01",
            "name": "Lote Misiones Nordeste",
            "province": "Misiones",
            "areaHa": 120.5,
            "centroid": {"lat": -26.875, "lng": -54.650},
            "primarySpecies": "Pino Taeda"
        },
        {
            "id": "lote-corrientes-02",
            "name": "Plantación Silvopastoril Ituzaingó",
            "province": "Corrientes",
            "areaHa": 245.8,
            "centroid": {"lat": -27.583, "lng": -56.681},
            "primarySpecies": "Eucalyptus Grandis"
        },
        {
            "id": "lote-entre-rios-03",
            "name": "Macizo Forestal Concordia",
            "province": "Entre Ríos",
            "areaHa": 85.2,
            "centroid": {"lat": -31.392, "lng": -58.017},
            "primarySpecies": "Eucalyptus Globulus"
        }
    ]

@app.post("/api/forest/stac")
def search_stac_catalog(req: STACSearchRequest):
    """Consulta el catálogo oficial Copernicus STAC para Sentinel-2 L2A"""
    try:
        geom_shape = shape(req.geometry.dict())
        bounds = geom_shape.bounds # (minx, miny, maxx, maxy)

        search_body = {
            "collections": ["sentinel-2-l2a"],
            "bbox": [bounds[0], bounds[1], bounds[2], bounds[3]],
            "datetime": f"{req.startDate}T00:00:00Z/{req.endDate}T23:59:59Z",
            "limit": 10,
            "query": {
                "eo:cloud_cover": {"lte": req.maxCloudCover}
            }
        }

        try:
            resp = requests.post(COPERNICUS_STAC_URL, json=search_body, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                features = data.get("features", [])
                if features:
                    parsed_products = []
                    for feat in features:
                        props = feat.get("properties", {})
                        parsed_products.append({
                            "id": feat.get("id"),
                            "date": props.get("datetime", "").split("T")[0],
                            "cloudCover": props.get("eo:cloud_cover", 0.0),
                            "collection": "sentinel-2-l2a",
                            "source": "Copernicus Sentinel-2",
                            "resolution": "10m",
                            "bands": ["B04 (Red)", "B08 (NIR)"]
                        })
                    return {
                        "success": True,
                        "available": True,
                        "status": "REAL",
                        "source": "Copernicus Data Space Ecosystem STAC",
                        "productsCount": len(parsed_products),
                        "bestProduct": parsed_products[0],
                        "products": parsed_products
                    }
        except Exception as stac_err:
            pass

        return {
            "success": False,
            "available": False,
            "status": "UNAVAILABLE",
            "reason": "Datos satelitales no disponibles para esta consulta (no se encontraron capturas reales o el servicio no respondió)."
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error procesando búsqueda STAC: {str(e)}")

@app.post("/api/forest/ndvi")
def calculate_ndvi(req: NDVIAnalysisRequest):
    """Calcula la matriz NDVI y estadísticas para un lote solo cuando existen bandas o píxeles reales"""
    try:
        geom_shape = shape(req.geometry.dict())
        area_sq_m = calculate_shapely_area(geom_shape)
        area_ha = round(area_sq_m / 10000.0, 2)

        return {
            "available": False,
            "status": "UNAVAILABLE",
            "indicator": "NDVI",
            "formula": "(NIR - RED) / (NIR + RED)",
            "date": req.date,
            "productId": req.productId,
            "areaHectares": area_ha,
            "reason": "NDVI no disponible: se requieren las bandas B04 y B08 procesadas de un ráster Sentinel-2 real."
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error en consulta NDVI: {str(e)}")

@app.post("/api/forest/changes")
def calculate_change_detection(req: ChangeDetectionRequest):
    """Ejecuta detección de cambios solo cuando existen dos observaciones NDVI reales comparables"""
    try:
        ndvi_a = calculate_ndvi(NDVIAnalysisRequest(geometry=req.geometry, date=req.dateA))
        ndvi_b = calculate_ndvi(NDVIAnalysisRequest(geometry=req.geometry, date=req.dateB))

        if not ndvi_a.get("available") or not ndvi_b.get("available"):
            return {
                "available": False,
                "status": "UNAVAILABLE",
                "period": {"dateA": req.dateA, "dateB": req.dateB},
                "reason": "No hay suficientes datos reales para determinar cambios (se requieren dos observaciones NDVI reales)."
            }

        mean_a = ndvi_a["stats"]["mean"]
        mean_b = ndvi_b["stats"]["mean"]
        delta_ndvi = round(mean_b - mean_a, 2)
        total_ha = ndvi_a.get("areaHectares", 10.0)

        return {
            "available": True,
            "status": "REAL",
            "period": {"dateA": req.dateA, "dateB": req.dateB},
            "deltaNDVI": delta_ndvi,
            "meanNDVIA": mean_a,
            "meanNDVIB": mean_b,
            "totalAreaHa": total_ha,
            "disclaimer": "Análisis preliminar de información territorial y teledetección."
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error en detección de cambios: {str(e)}")

@app.post("/api/forest/analyze")
def run_full_forest_analysis_endpoint(req: ChangeDetectionRequest):
    """Endpoint unificado que ejecuta búsqueda STAC, NDVI, detección de cambios y aptitud territorial"""
    stac_res = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate="2025-01-01", endDate=req.dateB))
    changes_res = calculate_change_detection(req)

    return {
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "geometry": req.geometry,
        "stac": stac_res,
        "changes": changes_res,
        "disclaimer": "Análisis preliminar de información territorial y teledetección."
    }

def calculate_shapely_area(geom_shape):
    """Calcula área aproximada en m2 usando el centroide latitud para escalar grados WGS84"""
    centroid = geom_shape.centroid
    lat_rad = math.radians(centroid.y)
    meters_per_deg_lat = 111132.92 - 559.82 * math.cos(2 * lat_rad)
    meters_per_deg_lng = 111412.84 * math.cos(lat_rad)

    # Escalar área proyectada
    return abs(geom_shape.area) * meters_per_deg_lat * meters_per_deg_lng

