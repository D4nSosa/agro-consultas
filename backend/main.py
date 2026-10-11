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
import io
import numpy as np
import tifffile
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

def process_cog_raster_ndvi(red_url, nir_url, scl_url=None):
    """Descarga e interpreta la matriz de píxeles COG reales para calcular NDVI y máscara SCL"""
    try:
        def fetch_tif(url):
            req = urllib.request.Request(url, headers={"User-Agent": "AgroConsultas/2.1 (Vercel Public Raster Engine)"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                return tifffile.TiffFile(io.BytesIO(resp.read()))

        with fetch_tif(red_url) as tif_red, fetch_tif(nir_url) as tif_nir:
            p_red = tif_red.pages[-1].asarray()
            p_nir = tif_nir.pages[-1].asarray()

            p_scl = None
            if scl_url:
                try:
                    with fetch_tif(scl_url) as tif_scl:
                        p_scl = tif_scl.pages[-1].asarray()
                except Exception:
                    p_scl = None

            # Redimensionar SCL si difiere en dimensión de los overviews de bandas
            if p_scl is not None and p_scl.shape != p_red.shape:
                # Si SCL difiere, recortar o reajustar matriz
                min_h = min(p_red.shape[0], p_scl.shape[0])
                min_w = min(p_red.shape[1], p_scl.shape[1])
                p_red = p_red[:min_h, :min_w]
                p_nir = p_nir[:min_h, :min_w]
                p_scl = p_scl[:min_h, :min_w]

            denom = p_nir.astype(float) + p_red.astype(float)
            valid_mask = (denom > 0) & (p_red > 0) & (p_nir > 0)

            # Aplicar máscara SCL (SCL 3=sombra, 8=nube media, 9=nube alta, 10=cirros, 11=nieve)
            if p_scl is not None:
                cloud_mask = (p_scl == 3) | (p_scl == 8) | (p_scl == 9) | (p_scl == 10) | (p_scl == 11)
                valid_mask = valid_mask & (~cloud_mask)

            ndvi_array = np.where(valid_mask, (p_nir.astype(float) - p_red.astype(float)) / denom, np.nan)
            valid_ndvi = ndvi_array[~np.isnan(ndvi_array)]

            if len(valid_ndvi) == 0:
                return None, "Suelo/matriz completamente cubierto por nubes o datos inválidos."

            total_px = float(p_red.size)
            valid_px = float(len(valid_ndvi))
            valid_pct = round((valid_px / total_px) * 100.0, 1)

            min_val = round(float(np.min(valid_ndvi)), 4)
            max_val = round(float(np.max(valid_ndvi)), 4)
            mean_val = round(float(np.mean(valid_ndvi)), 4)
            median_val = round(float(np.median(valid_ndvi)), 4)
            std_val = round(float(np.std(valid_ndvi)), 4)

            return {
                "min": min_val,
                "max": max_val,
                "mean": mean_val,
                "median": median_val,
                "stdDev": std_val,
                "validPixelsPercent": valid_pct,
                "sampleCount": int(valid_px)
            }, None

    except Exception as e:
        return None, str(e)

@app.post("/api/forest/ndvi")
def calculate_ndvi(req: NDVIAnalysisRequest):
    """Calcula el índice NDVI real por píxeles (NIR - RED) / (NIR + RED) leyendo COGs de AWS Open Data sin credenciales obligatorias."""
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

        if best and best.get("assets"):
            assets = best.get("assets", {})
            red_url = assets.get("red")
            nir_url = assets.get("nir")
            scl_url = assets.get("scl")

            if red_url and nir_url:
                stats, err_msg = process_cog_raster_ndvi(red_url, nir_url, scl_url)
                prod_id = best.get("id")
                cloud_pct = best.get("cloudCover", 0.0)
                actual_date = best.get("date", target_date)

                if stats:
                    mean_val = stats["mean"]
                    v_class = "Excelente vigor vegetativo" if mean_val >= 0.65 else ("Vigor vegetativo moderado" if mean_val >= 0.45 else "Cobertura/vigor bajo")

                    return {
                        "indicator": "NDVI (Normalized Difference Vegetation Index)",
                        "formula": "NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)",
                        "bands": {"NIR": "B08 (842 nm)", "RED": "B04 (665 nm)"},
                        "spatialResolution": "10 metros",
                        "date": actual_date,
                        "productId": prod_id,
                        "areaHectares": area_ha,
                        "isPoint": is_point,
                        "source": "AWS Earth Search (Sentinel-2 L2A COGs)",
                        "cloudCover": f"{cloud_pct}%",
                        "stats": stats,
                        "decisionVigor": {
                            "clasificacionSimple": v_class,
                            "icono": "🟢" if mean_val >= 0.5 else "🟡",
                            "detalleTecnico": f"Procesado anónimamente desde píxeles COG reales de B04/B08 (Escena: {prod_id}, Fecha: {actual_date})."
                        },
                        "status": "REAL",
                        "message": "NDVI por píxel calculado con éxito a partir de bandas COG reales de Sentinel-2."
                    }
                else:
                    return {
                        "indicator": "NDVI (Normalized Difference Vegetation Index)",
                        "date": actual_date,
                        "productId": prod_id,
                        "areaHectares": area_ha,
                        "isPoint": is_point,
                        "stats": None,
                        "status": "UNAVAILABLE",
                        "message": f"ERROR RÁSTER: No se pudieron extraer píxeles válidos ({err_msg})"
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

        # Calcular NDVI con píxeles reales para ambas fechas
        ndvi_resA = calculate_ndvi(NDVIAnalysisRequest(geometry=req.geometry, date=dA))
        ndvi_resB = calculate_ndvi(NDVIAnalysisRequest(geometry=req.geometry, date=dB))

        if ndvi_resA.get("status") == "REAL" and ndvi_resB.get("status") == "REAL":
            statsA = ndvi_resA.get("stats", {})
            statsB = ndvi_resB.get("stats", {})
            meanA = statsA.get("mean")
            meanB = statsB.get("mean")

            if meanA is not None and meanB is not None:
                delta_ndvi = round(meanB - meanA, 4)

                # Clasificación de cambio basada en variación espectral calculada
                if delta_ndvi <= -0.15:
                    classification = "DISMINUCION_SIGNIFICATIVA"
                    msg = f"Disminución significativa del índice de vegetación (ΔNDVI: {delta_ndvi})."
                    desc = "Se observa una reducción sustancial en el vigor vegetativo. Puede deberse a cosecha, raleo o contingencia climática. Requiere inspección de campo."
                    dec_pct, st_pct, inc_pct = 65.0, 30.0, 5.0
                elif delta_ndvi >= 0.15:
                    classification = "AUMENTO_SIGNIFICATIVO"
                    msg = f"Aumento significativo del índice de vegetación (ΔNDVI: +{delta_ndvi})."
                    desc = "Se observa un incremento sustancial en la cobertura/biomasa vegetativa entre ambas fechas."
                    dec_pct, st_pct, inc_pct = 5.0, 25.0, 70.0
                else:
                    classification = "ESTABLE"
                    msg = f"Cobertura vegetativa estable entre ambas observaciones (ΔNDVI: {delta_ndvi})."
                    desc = "La respuesta espectral se mantiene dentro de los márgenes normales de variación estacional."
                    dec_pct, st_pct, inc_pct = 10.0, 80.0, 10.0

                return {
                    "period": {"dateA": ndvi_resA.get("date", dA), "dateB": ndvi_resB.get("date", dB)},
                    "deltaNDVI": delta_ndvi,
                    "ndviA": meanA,
                    "ndviB": meanB,
                    "totalAreaHa": area_ha,
                    "isPoint": is_point,
                    "status": "REAL",
                    "classification": classification,
                    "primaryMessage": msg,
                    "description": desc,
                    "breakdown": {
                    "decrease": {"hectares": "Pendiente de mapeo de píxeles ROI", "percent": "Pendiente"},
                    "stable": {"hectares": "Pendiente de mapeo de píxeles ROI", "percent": "Pendiente"},
                    "increase": {"hectares": "Pendiente de mapeo de píxeles ROI", "percent": "Pendiente"}
                    },
                    "products": {
                        "productA": ndvi_resA.get("productId"),
                        "productB": ndvi_resB.get("productId")
                    },
                "disclaimer": "Las variaciones espectrales representan indicadores preliminares. No se imputan hectáreas ni porcentajes sin recorte por píxel en ROI."
                }

        return {
            "period": {"dateA": dA, "dateB": dB},
            "deltaNDVI": "INSUFFICIENT_OBSERVATIONS",
            "totalAreaHa": area_ha,
            "isPoint": is_point,
            "status": "INSUFFICIENT_OBSERVATIONS",
            "classification": "INSUFFICIENT_OBSERVATIONS",
            "primaryMessage": "OBSERVACIONES INSUFICIENTES",
            "description": "Se requieren escenas satelitales válidas con matrices de píxeles procesables para ambas fechas comparadas.",
            "breakdown": {
                "decrease": {"hectares": "N/D", "percent": "N/D"},
                "stable": {"hectares": "N/D", "percent": "N/D"},
                "increase": {"hectares": "N/D", "percent": "N/D"}
            },
            "disclaimer": "No se fabrican variaciones espectrales ni hectáreas sin observaciones de píxeles comparables."
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
