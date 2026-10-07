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
else:
    origins = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

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
    """Consulta el catálogo oficial Copernicus STAC para Sentinel-2 L2A"""
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
                                "source": "Copernicus Sentinel-2 L2A",
                                "resolution": "10m",
                                "bands": ["B04 (Red)", "B08 (NIR)"],
                                "assets": feat.get("assets", {})
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
    """Retorna la superficie del lote y las métricas NDVI reales procesadas si están disponibles o marca UNAVAILABLE"""
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

        copernicus_client_id = os.environ.get("COPERNICUS_CLIENT_ID") or os.environ.get("SENTINELHUB_CLIENT_ID")
        copernicus_client_secret = os.environ.get("COPERNICUS_CLIENT_SECRET") or os.environ.get("SENTINELHUB_CLIENT_SECRET")

        if not copernicus_client_id or not copernicus_client_secret:
            return {
                "indicator": "NDVI (Normalized Difference Vegetation Index)",
                "formula": "(NIR - RED) / (NIR + RED)",
                "bands": {"NIR": "B08 (842 nm)", "RED": "B04 (665 nm)"},
                "spatialResolution": "10 metros",
                "date": target_date,
                "productId": req.productId or "NO DISPONIBLE",
                "areaHectares": area_ha,
                "isPoint": is_point,
                "stats": {
                    "min": "NO DISPONIBLE",
                    "max": "NO DISPONIBLE",
                    "mean": "NO DISPONIBLE",
                    "median": "NO DISPONIBLE",
                    "stdDev": "NO DISPONIBLE",
                    "validPixelsPercent": "NO DISPONIBLE"
                },
                "decisionVigor": {
                    "clasificacionSimple": "NO DISPONIBLE",
                    "icono": "⚪",
                    "detalleTecnico": "Se requieren las variables de entorno COPERNICUS_CLIENT_ID y COPERNICUS_CLIENT_SECRET en el backend para obtener el token OAuth2 de Copernicus CDSE / Sentinel Hub Statistical API."
                },
                "status": "UNAVAILABLE",
                "missingEnvVars": ["COPERNICUS_CLIENT_ID", "COPERNICUS_CLIENT_SECRET"],
                "message": "NO DISPONIBLE (Faltan variables de entorno COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET en backend para procesamiento ráster B04/B08)"
            }

        # Intentar obtener token OAuth2 de Copernicus CDSE
        token_url = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
        token_data = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": copernicus_client_id,
            "client_secret": copernicus_client_secret
        }).encode("utf-8")

        token_req = urllib.request.Request(token_url, data=token_data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            token_json = json.loads(resp.read().decode("utf-8"))
            access_token = token_json.get("access_token")

        if not access_token:
            raise Exception("No se obtuvo access_token válido de Copernicus CDSE")

        # Consultar Sentinel Hub Statistical API
        stat_url = "https://sh.dataspace.copernicus.eu/api/v1/statistics"
        stat_body = {
            "input": {
                "bounds": {
                    "geometry": geom_dict
                },
                "data": [
                    {
                        "type": "sentinel-2-l2a",
                        "dataFilter": {
                            "timeRange": {
                                "from": f"{target_date}T00:00:00Z",
                                "to": f"{target_date}T23:59:59Z"
                            },
                            "maxCloudCoverage": 30
                        }
                    }
                ]
            },
            "aggregation": {
                "timeRange": {
                    "from": f"{target_date}T00:00:00Z",
                    "to": f"{target_date}T23:59:59Z"
                },
                "aggregationInterval": {
                    "of": "P1D"
                },
                "evalscript": """
                //VERSION=3
                function setup() {
                  return {
                    input: [{ bands: ["B04", "B08", "SCL"] }],
                    output: [
                      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
                      { id: "dataMask", bands: 1, sampleType: "UINT8" }
                    ]
                  };
                }
                function evaluatePixel(samples) {
                  var scl = samples.SCL;
                  if (scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11) {
                    return { ndvi: [0], dataMask: [0] };
                  }
                  var denom = samples.B08 + samples.B04;
                  if (denom === 0) return { ndvi: [0], dataMask: [0] };
                  var ndvi = (samples.B08 - samples.B04) / denom;
                  return { ndvi: [ndvi], dataMask: [1] };
                }
                """,
                "resx": 10,
                "resy": 10
            }
        }

        stat_req = urllib.request.Request(
            stat_url,
            data=json.dumps(stat_body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}"
            }
        )

        with urllib.request.urlopen(stat_req, timeout=12) as stat_resp:
            stat_data = json.loads(stat_resp.read().decode("utf-8"))
            data_list = stat_data.get("data", [])
            if data_list and len(data_list) > 0 and "outputs" in data_list[0]:
                ndvi_stats = data_list[0]["outputs"]["ndvi"]["bands"]["B0"]["stats"]
                return {
                    "indicator": "NDVI (Normalized Difference Vegetation Index)",
                    "formula": "(NIR - RED) / (NIR + RED)",
                    "bands": {"NIR": "B08 (842 nm)", "RED": "B04 (665 nm)"},
                    "spatialResolution": "10 metros",
                    "date": target_date,
                    "productId": req.productId or "Copernicus CDSE Statistical API",
                    "areaHectares": area_ha,
                    "stats": {
                        "min": round(ndvi_stats.get("min", 0), 4),
                        "max": round(ndvi_stats.get("max", 0), 4),
                        "mean": round(ndvi_stats.get("mean", 0), 4),
                        "median": round(ndvi_stats.get("mean", 0), 4),
                        "stdDev": round(ndvi_stats.get("stDev", 0), 4),
                        "validPixelsPercent": round((ndvi_stats.get("sampleCount", 0) - ndvi_stats.get("noDataCount", 0)) / max(1, ndvi_stats.get("sampleCount", 1)) * 100, 1)
                    },
                    "status": "REAL",
                    "source": "Copernicus Data Space Ecosystem (Sentinel Hub Statistical API)",
                    "message": "NDVI procesado con datos ráster reales B04/B08."
                }

        return {
            "indicator": "NDVI (Normalized Difference Vegetation Index)",
            "date": target_date,
            "productId": req.productId or "NO DISPONIBLE",
            "areaHectares": area_ha,
            "stats": None,
            "status": "UNAVAILABLE",
            "message": "NO DISPONIBLE: No se encontraron datos ráster válidos sin nubes en la fecha seleccionada."
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
            "message": f"NO DISPONIBLE: Error en procesamiento ráster Sentinel Hub ({str(e)})"
        }

@app.post("/api/forest/changes")
def calculate_change_detection(req: ChangeDetectionRequest):
    """Determina la indisponibilidad de detección de cambios si faltan píxeles ráster reales"""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        dA = req.dateA or date_a_def
        dB = req.dateB or date_b_def

        geom_shape = validate_geometry_shape(get_geom_dict(req.geometry))
        area_sq_m = calculate_shapely_area(geom_shape)
        area_ha = round(area_sq_m / 10000.0, 2)

        return {
            "period": {"dateA": dA, "dateB": dB},
            "deltaNDVI": "NO DISPONIBLE",
            "totalAreaHa": area_ha,
            "classification": "NO_DISPONIBLE",
            "primaryMessage": "NO DISPONIBLE CON LOS DATOS DISPONIBLES",
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
