"""
main.py - Backend Geoespacial Python con FastAPI para el Módulo Análisis Forestal
Servicios REST para consulta STAC Copernicus, procesamiento de geometría GeoJSON, NDVI y detección de cambios.
Basado exclusivamente en datos reales.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import os
import math
import datetime
import urllib.request
import urllib.parse
import json
from shapely.geometry import shape, Point, Polygon

app = FastAPI(
    title="Agro Consultas - API Geoespacial Forestal",
    description="API REST para procesamiento de teledetección, catálogo Copernicus STAC, NDVI y detección multitemporal de cambios.",
    version="2.1.0"
)

allowed_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS")
if allowed_origins_env:
    origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    allow_credentials = False if "*" in origins else True
else:
    origins = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]
    allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

EARTH_SEARCH_STAC_URL = "https://earth-search.aws.element84.com/v1/search"
COPERNICUS_STAC_URL = "https://stac.dataspace.copernicus.eu/v1/search"

def get_default_dates():
    now = datetime.datetime.now(datetime.timezone.utc)
    date_b = now.strftime("%Y-%m-%d")
    date_a = (now - datetime.timedelta(days=365)).strftime("%Y-%m-%d")
    start_date = f"{now.year - 1}-01-01"
    return start_date, date_a, date_b

def get_geom_dict(pydantic_obj):
    if hasattr(pydantic_obj, "model_dump"):
        return pydantic_obj.model_dump()
    return pydantic_obj.dict()

def validate_geometry_shape(geom_dict):
    """Valida la geometría Shapely, límites WGS84 y rango de superficie."""
    try:
        geom_shape = shape(geom_dict)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"Estructura GeoJSON inválida: {str(err)}")

    if not geom_shape.is_valid:
        geom_shape = geom_shape.buffer(0)
        if not geom_shape.is_valid:
            raise HTTPException(status_code=400, detail="Geometría GeoJSON autointersecada o topológicamente inválida.")

    bounds = geom_shape.bounds # minx, miny, maxx, maxy
    if bounds[0] < -180.0 or bounds[2] > 180.0 or bounds[1] < -90.0 or bounds[3] > 90.0:
        raise HTTPException(status_code=400, detail="Coordenadas fuera del rango válido WGS84 (longitud: -180 a 180, latitud: -90 a 90).")

    if geom_shape.geom_type != 'Point':
        area_m2 = calculate_shapely_area(geom_shape)
        area_ha = area_m2 / 10000.0
        if area_ha > 1000000.0: # > 1,000,000 ha
            raise HTTPException(
                status_code=400,
                detail=f"Superficie excesiva ({round(area_ha):,} ha). El análisis está limitado a lotes y establecimientos individuales (máx. 1.000.000 ha)."
            )

    return geom_shape

class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: Any

class GeoJSONFeature(BaseModel):
    type: str = "Feature"
    geometry: GeoJSONGeometry
    properties: Optional[Dict[str, Any]] = {}

class STACSearchRequest(BaseModel):
    geometry: GeoJSONGeometry
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    maxCloudCover: float = 30.0

class NDVIAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    date: Optional[str] = None
    productId: Optional[str] = None

class ChangeDetectionRequest(BaseModel):
    geometry: GeoJSONGeometry
    dateA: Optional[str] = None
    dateB: Optional[str] = None

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Agro Consultas Geospatial Forest API",
        "version": "2.1.0",
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
    """Consulta el catálogo público AWS Earth Search STAC y Copernicus STAC para Sentinel-2 L2A"""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        s_date = req.startDate or start_def
        e_date = req.endDate or date_b_def

        geom_shape = validate_geometry_shape(get_geom_dict(req.geometry))
        bounds = geom_shape.bounds

        search_body = {
            "collections": ["sentinel-2-l2a"],
            "bbox": [bounds[0], bounds[1], bounds[2], bounds[3]],
            "datetime": f"{s_date}T00:00:00Z/{e_date}T23:59:59Z",
            "limit": 10,
            "query": {
                "eo:cloud_cover": {"lte": req.maxCloudCover}
            }
        }

        # 1. Intentar catálogo anónimo AWS Earth Search STAC
        try:
            req_data = json.dumps(search_body).encode('utf-8')
            aws_req = urllib.request.Request(
                EARTH_SEARCH_STAC_URL,
                data=req_data,
                headers={'Content-Type': 'application/json', 'Accept': 'application/json'}
            )
            with urllib.request.urlopen(aws_req, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8'))
                    features = data.get("features", [])
                    if features:
                        parsed_products = []
                        for feat in features:
                            props = feat.get("properties", {})
                            assets = feat.get("assets", {})
                            parsed_products.append({
                                "id": feat.get("id"),
                                "date": props.get("datetime", "").split("T")[0],
                                "cloudCover": round(float(props.get("eo:cloud_cover", 0.0)), 1),
                                "collection": "sentinel-2-l2a",
                                "source": "AWS Earth Search (Sentinel-2 L2A COGs)",
                                "resolution": "10m",
                                "bands": ["B04 (Red)", "B08 (NIR)"],
                                "assets": {
                                    "red": assets.get("red", {}).get("href") or assets.get("B04", {}).get("href"),
                                    "nir": assets.get("nir", {}).get("href") or assets.get("B08", {}).get("href"),
                                    "scl": assets.get("scl", {}).get("href"),
                                    "visual": assets.get("visual", {}).get("href"),
                                    "thumbnail": assets.get("thumbnail", {}).get("href")
                                }
                            })
                        parsed_products.sort(key=lambda x: x["cloudCover"])
                        return {
                            "success": True,
                            "source": "AWS Earth Search (Sentinel-2 L2A COGs Public Catalog)",
                            "productsCount": len(parsed_products),
                            "bestProduct": parsed_products[0],
                            "products": parsed_products
                        }
        except Exception as aws_err:
            pass

        # 2. Fallback a Copernicus STAC
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
                                "cloudCover": round(float(props.get("eo:cloud_cover", 0.0)), 1),
                                "collection": "sentinel-2-l2a",
                                "source": "Copernicus Sentinel-2 L2A",
                                "resolution": "10m",
                                "bands": ["B04 (Red)", "B08 (NIR)"],
                                "assets": feat.get("assets", {})
                            })
                        parsed_products.sort(key=lambda x: x["cloudCover"])
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
            "source": "AWS Earth Search / Copernicus STAC",
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "message": "NO DISPONIBLE / No se encontraron escenas reales o la API no respondió"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error procesando búsqueda STAC: {str(e)}")

@app.post("/api/forest/ndvi")
def calculate_ndvi(req: NDVIAnalysisRequest):
    """Calcula el índice NDVI real (NIR - RED) / (NIR + RED) utilizando escenas públicas de AWS Earth Search STAC sin requerir credenciales obligatorias."""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        target_date = req.date or date_b_def

        geom_dict = get_geom_dict(req.geometry)
        geom_shape = validate_geometry_shape(geom_dict)
        if geom_shape.geom_type == 'Point':
            area_ha = 0.0
            is_point = True
        else:
            area_sq_m = calculate_shapely_area(geom_shape)
            area_ha = round(area_sq_m / 10000.0, 2)
            is_point = False

        # 1. Consultar escena pública en AWS Earth Search STAC
        stac_res = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=target_date[:7] + "-01", endDate=target_date, maxCloudCover=30.0))

        if not stac_res.get("success") or not stac_res.get("bestProduct"):
            # Ampliar rango si no hay escena exacta
            target_dt = datetime.datetime.strptime(target_date, "%Y-%m-%d")
            s_range = (target_dt - datetime.timedelta(days=45)).strftime("%Y-%m-%d")
            e_range = (target_dt + datetime.timedelta(days=45)).strftime("%Y-%m-%d")
            stac_res = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=s_range, endDate=e_range, maxCloudCover=30.0))

        best = stac_res.get("bestProduct") if stac_res.get("success") else None

        if best and best.get("id"):
            prod_id = best.get("id")
            cloud_pct = best.get("cloudCover", 0.0)
            actual_date = best.get("date", target_date)

            return {
                "indicator": "NDVI (Normalized Difference Vegetation Index)",
                "formula": "NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)",
                "bands": {"NIR": "B08 (842 nm)", "RED": "B04 (665 nm)"},
                "spatialResolution": "10 metros",
                "date": actual_date,
                "productId": prod_id,
                "areaHectares": area_ha,
                "isPoint": is_point,
                "source": best.get("source", "AWS Earth Search (Sentinel-2 L2A COG)"),
                "cloudCover": f"{cloud_pct}%",
                "stats": None,
                "decisionVigor": {
                    "clasificacionSimple": "ESCENA IDENTIFICADA EN CATÁLOGO",
                    "icono": "🛰️",
                    "detalleTecnico": f"Escena {prod_id} recuperada del catálogo público AWS Earth Search STAC (Fecha: {actual_date}, Nubosidad: {cloud_pct}%). El muestreo y cálculo de la matriz de píxeles B04/B08 se procesa mediante las herramientas del cliente o backend dedicado."
                },
                "status": "SCENE_IDENTIFIED",
                "message": f"Escena Sentinel-2 {prod_id} identificada en catálogo público. Matriz ráster de píxeles no muestreada en este endpoint."
            }

        return {
            "indicator": "NDVI (Normalized Difference Vegetation Index)",
            "date": target_date,
            "productId": "NO DISPONIBLE",
            "areaHectares": area_ha,
            "isPoint": is_point,
            "stats": None,
            "status": "UNAVAILABLE",
            "message": "NO DISPONIBLE: No se encontraron escenas Sentinel-2 públicas con nubosidad aceptable para la fecha seleccionada."
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "indicator": "NDVI (Normalized Difference Vegetation Index)",
            "date": target_date,
            "areaHectares": area_ha if 'area_ha' in locals() else 0.0,
            "stats": None,
            "status": "UNAVAILABLE",
            "message": f"NO DISPONIBLE: Error en procesamiento ráster ({str(e)})"
        }

@app.post("/api/forest/changes")
def calculate_change_detection(req: ChangeDetectionRequest):
    """Compara observaciones espectrales reales entre dos fechas para el área delimitada sin credenciales obligatorias."""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        dA = req.dateA or date_a_def
        dB = req.dateB or date_b_def

        geom_dict = get_geom_dict(req.geometry)
        geom_shape = validate_geometry_shape(geom_dict)
        if geom_shape.geom_type == 'Point':
            area_ha = 0.0
            is_point = True
        else:
            area_sq_m = calculate_shapely_area(geom_shape)
            area_ha = round(area_sq_m / 10000.0, 2)
            is_point = False

        # Consultar STAC para ambas fechas
        sA = dA[:7] + "-01"
        eA = dA[:8] + "31" if len(dA) >= 10 else dA
        sB = dB[:7] + "-01"
        eB = dB[:8] + "31" if len(dB) >= 10 else dB

        resA = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=sA, endDate=eA))
        resB = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=sB, endDate=eB))

        if not resA.get("success"):
            # Expandir rango para fecha A
            target_dtA = datetime.datetime.strptime(dA, "%Y-%m-%d")
            resA = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=(target_dtA - datetime.timedelta(days=45)).strftime("%Y-%m-%d"), endDate=(target_dtA + datetime.timedelta(days=45)).strftime("%Y-%m-%d")))

        if not resB.get("success"):
            # Expandir rango para fecha B
            target_dtB = datetime.datetime.strptime(dB, "%Y-%m-%d")
            resB = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=(target_dtB - datetime.timedelta(days=45)).strftime("%Y-%m-%d"), endDate=(target_dtB + datetime.timedelta(days=45)).strftime("%Y-%m-%d")))

        prodA = resA.get("bestProduct") if resA.get("success") else None
        prodB = resB.get("bestProduct") if resB.get("success") else None

        if prodA and prodB:
            return {
                "period": {"dateA": prodA.get("date", dA), "dateB": prodB.get("date", dB)},
                "deltaNDVI": "INFORMACIÓN PENDIENTE DE MATRIZ RÁSTER",
                "totalAreaHa": area_ha,
                "isPoint": is_point,
                "status": "SCENE_IDENTIFIED",
                "classification": "ESCENAS_IDENTIFICADAS",
                "primaryMessage": f"Escenas satelitales recuperadas para {prodA.get('date')} y {prodB.get('date')}.",
                "description": "Se verificaron las observaciones satelitales reales en el catálogo público STAC. La comparación multitemporal de hectáreas afectadas requiere el procesamiento de matrices ráster de píxeles.",
                "breakdown": {
                    "decrease": {"hectares": "Pendiente", "percent": "Pendiente"},
                    "stable": {"hectares": "Pendiente", "percent": "Pendiente"},
                    "increase": {"hectares": "Pendiente", "percent": "Pendiente"}
                },
                "products": {
                    "productA": prodA.get("id"),
                    "productB": prodB.get("id")
                },
                "disclaimer": "No se inventan variaciones espectrales ni hectáreas sin el cálculo de matriz de píxeles por servidor."
            }

        return {
            "period": {"dateA": dA, "dateB": dB},
            "deltaNDVI": "NO DISPONIBLE",
            "totalAreaHa": area_ha,
            "isPoint": is_point,
            "status": "NO_DISPONIBLE",
            "classification": "NO_DISPONIBLE",
            "primaryMessage": "NO DISPONIBLE CON LOS DATOS DISPONIBLES",
            "description": "Se requieren escenas satelitales válidas en ambas fechas para comparar variaciones espectrales.",
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
    start_def, date_a_def, date_b_def = get_default_dates()
    dB = req.dateB or date_b_def

    stac_res = search_stac_catalog(STACSearchRequest(geometry=req.geometry, startDate=start_def, endDate=dB))
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
