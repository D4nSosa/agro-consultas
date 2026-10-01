"""
main.py - Backend Geoespacial Python con FastAPI para el Módulo Análisis Forestal
Servicios REST para consulta STAC Copernicus, procesamiento de geometría GeoJSON, NDVI y detección de cambios.
Basado exclusivamente en datos reales.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import math
import datetime
import urllib.request
import json
from shapely.geometry import shape, Point, Polygon

app = FastAPI(
    title="Agro Consultas - API Geoespacial Forestal",
    description="API REST para procesamiento de teledetección, catálogo Copernicus STAC, NDVI y detección multitemporal de cambios.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COPERNICUS_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search"

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
    productId: Optional[str] = None

class ChangeDetectionRequest(BaseModel):
    geometry: GeoJSONGeometry
    dateA: str = "2025-08-15"
    dateB: str = "2026-08-15"

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Agro Consultas Geospatial Forest API",
        "version": "2.0.0",
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
    """Retorna respuesta informativa sobre soporte de lotes: no hay lotes de ejemplo predeterminados"""
    return []

@app.post("/api/forest/stac")
def search_stac_catalog(req: STACSearchRequest):
    """Consulta el catálogo oficial Copernicus STAC para Sentinel-2 L2A"""
    try:
        geom_shape = shape(req.geometry.dict())
        bounds = geom_shape.bounds

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
            req_data = json.dumps(search_body).encode('utf-8')
            stac_req = urllib.request.Request(
                COPERNICUS_STAC_URL,
                data=req_data,
                headers={'Content-Type': 'application/json', 'Accept': 'application/json'}
            )
            with urllib.request.urlopen(stac_req, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
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
                            "source": "Copernicus Data Space Ecosystem STAC",
                            "productsCount": len(parsed_products),
                            "bestProduct": parsed_products[0],
                            "products": parsed_products
                        }
        except Exception as stac_err:
            pass

        return {
            "success": False,
            "source": "Copernicus Data Space Ecosystem STAC",
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "message": "NO DISPONIBLE / No se encontraron escenas reales o la API no respondió"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error procesando búsqueda STAC: {str(e)}")

@app.post("/api/forest/ndvi")
def calculate_ndvi(req: NDVIAnalysisRequest):
    """Retorna la superficie del lote e indica la necesidad de credenciales S3 para cálculo ráster"""
    try:
        geom_shape = shape(req.geometry.dict())
        area_sq_m = calculate_shapely_area(geom_shape)
        area_ha = round(area_sq_m / 10000.0, 2)

        return {
            "indicator": "NDVI",
            "formula": "(NIR - RED) / (NIR + RED)",
            "bands": {"NIR": "B08", "RED": "B04"},
            "date": req.date,
            "productId": req.productId or "NO DISPONIBLE",
            "areaHectares": area_ha,
            "stats": {
                "min": "NO DISPONIBLE",
                "max": "NO DISPONIBLE",
                "mean": "NO DISPONIBLE",
                "median": "NO DISPONIBLE"
            },
            "status": "UNAVAILABLE",
            "message": "NO DISPONIBLE (Se requieren credenciales Copernicus CDSE S3 para descarga y cálculo de píxeles B04/B08)"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error en endpoint NDVI: {str(e)}")

@app.post("/api/forest/changes")
def calculate_change_detection(req: ChangeDetectionRequest):
    """Determina la indisponibilidad de detección de cambios si faltan píxeles ráster reales"""
    try:
        geom_shape = shape(req.geometry.dict())
        area_sq_m = calculate_shapely_area(geom_shape)
        area_ha = round(area_sq_m / 10000.0, 2)

        return {
            "period": {"dateA": req.dateA, "dateB": req.dateB},
            "deltaNDVI": "NO DISPONIBLE",
            "totalAreaHa": area_ha,
            "classification": "NO_DISPONIBLE",
            "message": "NO SE PUEDE DETERMINAR CON LOS DATOS DISPONIBLES",
            "breakdown": {
                "decrease": {"hectares": "N/D", "percent": "N/D"},
                "stable": {"hectares": "N/D", "percent": "N/D"},
                "increase": {"hectares": "N/D", "percent": "N/D"}
            },
            "disclaimer": "No se fabrican porcentajes ni superficies simuladas cuando faltan observaciones ráster comparables."
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error en detección de cambios: {str(e)}")

@app.post("/api/forest/analyze")
def run_full_forest_analysis_endpoint(req: ChangeDetectionRequest):
    """Endpoint unificado que ejecuta búsqueda STAC y evaluación de trazabilidad"""
    stac_res = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate="2025-01-01", endDate=req.dateB))
    changes_res = calculate_change_detection(req)

    return {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "geometry": req.geometry,
        "stac": stac_res,
        "changes": changes_res,
        "disclaimer": "Análisis basado en datos reales trazables de teledetección."
    }

def calculate_shapely_area(geom_shape):
    """Calcula área aproximada en m2 usando el centroide latitud para escalar grados WGS84"""
    centroid = geom_shape.centroid
    lat_rad = math.radians(centroid.y)
    meters_per_deg_lat = 111132.92 - 559.82 * math.cos(2 * lat_rad)
    meters_per_deg_lng = 111412.84 * math.cos(lat_rad)

    return abs(geom_shape.area) * meters_per_deg_lat * meters_per_deg_lng
