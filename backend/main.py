"""
main.py - Backend Geoespacial Python con FastAPI para el Módulo Análisis Forestal
Servicios REST para consulta STAC Sentinel-2, procesamiento de geometría GeoJSON, NDVI y detección de cambios.
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
import concurrent.futures
import json
import io
import numpy as np
import tifffile
from backend.sentinel1_calibration import process_sentinel1_grd
from backend.processing_engine import router as processing_engine_router
from shapely.geometry import shape, Point, Polygon
from shapely.ops import transform as transform_geometry

app = FastAPI(
    title="Agro Consultas - API Geoespacial Forestal",
    description="API REST para procesamiento de teledetección, catálogo Sentinel-2 STAC, NDVI y detección multitemporal de cambios.",
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
PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PLANETARY_COMPUTER_SAS_TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsateuwest/landsat-c2"
PLANETARY_COMPUTER_SAS_CACHE = {"token": None, "expires_at": None}


def _get_planetary_computer_sas_token():
    """Obtiene/cacha token SAS público y temporal para el contenedor Landsat C2 de Planetary Computer."""
    now = datetime.datetime.now(datetime.timezone.utc)
    cached_token = PLANETARY_COMPUTER_SAS_CACHE.get("token")
    cached_expiry = PLANETARY_COMPUTER_SAS_CACHE.get("expires_at")
    if cached_token and cached_expiry and cached_expiry > now + datetime.timedelta(minutes=5):
        return cached_token

    request = urllib.request.Request(
        PLANETARY_COMPUTER_SAS_TOKEN_URL,
        headers={"Accept": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read(200_000).decode("utf-8"))

    token = payload.get("token")
    expiry_text = payload.get("msft:expiry")
    if not token:
        raise RuntimeError("Planetary Computer no devolvió token SAS para Landsat C2.")
    try:
        expires_at = datetime.datetime.fromisoformat(expiry_text.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        expires_at = now + datetime.timedelta(minutes=20)

    PLANETARY_COMPUTER_SAS_CACHE["token"] = token
    PLANETARY_COMPUTER_SAS_CACHE["expires_at"] = expires_at
    return token


def _sign_planetary_computer_asset(href):
    """Firma únicamente assets Landsat alojados en el contenedor público documentado."""
    if not href:
        return href
    parsed = urllib.parse.urlparse(href)
    if parsed.netloc != "landsateuwest.blob.core.windows.net" or not parsed.path.startswith("/landsat-c2/"):
        return href
    token = _get_planetary_computer_sas_token()
    separator = "&" if "?" in href else "?"
    return f"{href}{separator}{token}"


INTA_CIRN_WMS_URL = "https://geo-nodo05.inta.gob.ar/geoserver/wms"
INTA_SOIL_CACHE = {}
INTA_SOIL_CACHE_TTL_SECONDS = 6 * 60 * 60

INTA_SOIL_PRODUCTS = {
    "ph_0_30": {
        "layer": "geonode:ph_0_30_nuevo_recorte_m_4d4cbbd459875375ae3e856e2870841f",
        "title": "Argentina - pH del suelo 0-30 cm",
        "depth": "0-30 cm",
        "unit": "pH",
        "resolution": 1000,
        "rmse": 0.84,
        "r2": 0.456,
        "bounds": {"west": -74.82579, "south": -55.11495, "east": -48.56087, "north": -21.57148},
        "kind": "ph"
    },
    "ph_30_100": {
        "layer": "geonode:ph_30_100_nuevo_recorte_m_cbccd7b512bb4f943ad9672e961bee3d",
        "title": "Argentina - pH del suelo 30-100 cm",
        "depth": "30-100 cm",
        "unit": "pH",
        "resolution": 1000,
        "rmse": 0.80,
        "r2": 0.523,
        "bounds": {"west": -74.52172, "south": -56.12095, "east": -47.16572, "north": -21.34695},
        "kind": "ph"
    },
    "salinity_0_30": {
        "layer": "geonode:suelos_salinos_0_30_recorte_9622e0e127b7ae1d157c7f49d41605f3",
        "title": "Argentina - Suelos afectados por sales 0-30 cm",
        "depth": "0-30 cm",
        "unit": None,
        "resolution": None,
        "bounds": {"west": -74.52172, "south": -56.12095, "east": -47.16572, "north": -21.34695},
        "kind": "salinity"
    },
    "salinity_30_100": {
        "layer": "geonode:suelos_salinos_30_100_recorte_437dcf998c66ee96455f4cb196eda5b1",
        "title": "Argentina - Suelos afectados por sales 30-100 cm",
        "depth": "30-100 cm",
        "unit": None,
        "resolution": None,
        "bounds": {"west": -74.52172, "south": -56.12095, "east": -47.16572, "north": -21.34695},
        "kind": "salinity"
    }
}


def _query_inta_soil_pixel(product_key, product, lat, lng):
    """Consulta un único píxel WMS. Conserva valores crudos y no interpreta clases sin leyenda."""
    delta = 0.01
    params = urllib.parse.urlencode({
        "service": "WMS",
        "version": "1.1.1",
        "request": "GetFeatureInfo",
        "layers": product["layer"],
        "query_layers": product["layer"],
        "styles": "",
        "srs": "EPSG:4326",
        "bbox": f"{lng - delta},{lat - delta},{lng + delta},{lat + delta}",
        "width": "101",
        "height": "101",
        "x": "50",
        "y": "50",
        "format": "image/png",
        "info_format": "application/json",
        "feature_count": "1"
    })
    request = urllib.request.Request(
        f"{INTA_CIRN_WMS_URL}?{params}",
        headers={"Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read(1_000_000).decode("utf-8"))
        features = payload.get("features", [])
        if not features:
            return {"status": "NO_DATA", "value": None, "rawValue": None}
        properties = features[0].get("properties") or {}
        raw_value = properties.get("GRAY_INDEX")
        try:
            raw_value = float(raw_value) if raw_value is not None else None
        except (TypeError, ValueError):
            raw_value = None

        if raw_value is None or not math.isfinite(raw_value):
            return {"status": "NO_VALUE", "value": None, "rawValue": None}

        if product["kind"] == "ph":
            # pH outside the physically meaningful 0–14 interval is a NoData/sentinel value.
            if not 0.0 <= raw_value <= 14.0:
                return {"status": "NODATA_SENTINEL", "value": None, "rawValue": raw_value}
            return {"status": "CARTOGRAPHIC", "value": round(raw_value, 3), "rawValue": raw_value}

        # Salinity layer returns raw classes (0/1/2 in the live sample); no interpretation until legend is verified.
        if raw_value == -9999:
            return {"status": "NODATA_SENTINEL", "value": None, "rawValue": raw_value}
        return {"status": "RAW_CLASS", "value": None, "rawValue": raw_value, "rawClass": raw_value}

    except urllib.error.HTTPError as exc:
        return {"status": "HTTP_ERROR", "value": None, "rawValue": None, "httpStatus": exc.code}
    except Exception as exc:
        return {"status": "UNAVAILABLE", "value": None, "rawValue": None, "error": f"{type(exc).__name__}: {exc}"}


@app.get("/api/soil/inta")
def get_inta_national_soil_data(lat: float, lng: float):
    """Consulta pH y suelos afectados por sales en las capas nacionales INTA-CIRN."""
    if not math.isfinite(lat) or not math.isfinite(lng) or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="Coordenadas inválidas; se requiere latitud y longitud WGS84.")

    cache_key = f"{round(lat, 3)}:{round(lng, 3)}"
    now = datetime.datetime.now(datetime.timezone.utc)
    cached = INTA_SOIL_CACHE.get(cache_key)
    if cached and (now - cached["cached_at"]).total_seconds() < INTA_SOIL_CACHE_TTL_SECONDS:
        result = dict(cached["data"])
        result["cacheHit"] = True
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            key: pool.submit(_query_inta_soil_pixel, key, product, lat, lng)
            for key, product in INTA_SOIL_PRODUCTS.items()
        }
        raw_results = {key: future.result() for key, future in futures.items()}

    products = {}
    for key, metadata in INTA_SOIL_PRODUCTS.items():
        sample = raw_results[key]
        products[key] = {
            "title": metadata["title"],
            "dataset": metadata["layer"],
            "depth": metadata["depth"],
            "value": sample.get("value"),
            "rawValue": sample.get("rawValue"),
            "rawClass": sample.get("rawClass"),
            "unit": metadata["unit"],
            "resolution": metadata["resolution"],
            "resolutionUnit": "m" if metadata["resolution"] else None,
            "crs": "EPSG:4326",
            "coverage": metadata["bounds"],
            "quality": (
                {"rmse": metadata["rmse"], "r2": metadata["r2"]}
                if metadata.get("kind") == "ph" else None
            ),
            "status": sample["status"],
            "limitations": (
                ["Modelo cartográfico de pH; pixel de 1 km; no equivale a análisis de laboratorio ni medición puntual."]
                if metadata.get("kind") == "ph"
                else ["Valor/clase cruda del WMS; leyenda y resolución deben verificarse antes de asignar significado agronómico."]
            )
        }

    valid_values = [
        item for item in products.values()
        if item["value"] is not None or item["rawClass"] is not None
    ]
    status = "CARTOGRAPHIC" if valid_values else "UNAVAILABLE"
    if valid_values and any(item["status"] not in ("CARTOGRAPHIC", "RAW_CLASS") for item in products.values()):
        status = "PARTIAL"

    result = {
        "source": "INTA - Centro de Investigación de Recursos Naturales (CIRN)",
        "sourceUrl": INTA_CIRN_WMS_URL,
        "dataset": "Mapas nacionales de pH y suelos afectados por sales",
        "sensor": None,
        "product": "Cartografía edáfica modelada",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "coverage": "Consultar bounding box de cada capa en products.*.coverage",
        "crs": "EPSG:4326",
        "license": None,
        "acquiredAt": None,
        "publishedAt": None,
        "retrievedAt": now.isoformat(),
        "sampleMethod": "Punto de consulta; si proviene de un lote, representa únicamente el centroide enviado.",
        "status": status,
        "quality": None,
        "limitations": [
            "El resultado es una consulta puntual de píxel y no una estadística zonal del polígono completo.",
            "Los mapas de pH tienen pixel de 1 km y métricas de ajuste publicadas por INTA.",
            "Las capas de suelos afectados por sales se entregan como clase/valor crudo hasta verificar su leyenda.",
            "Los valores NoData o fuera del rango de pH 0–14 se devuelven como null."
        ],
        "products": products,
        "cacheHit": False
    }

    if valid_values:
        INTA_SOIL_CACHE[cache_key] = {"cached_at": now, "data": result}
    return result



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
    collection: str = "sentinel-2-l2a"
    productId: Optional[str] = None

class NDVIAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    date: Optional[str] = None
    productId: Optional[str] = None
    collection: str = "auto"

class SpectralAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    date: Optional[str] = None
    productId: Optional[str] = None
    collection: str = "auto"
    indices: List[str] = Field(default_factory=lambda: ["ndvi", "evi", "ndmi", "gndvi", "ndre"])


class ChangeDetectionRequest(BaseModel):
    geometry: GeoJSONGeometry
    dateA: Optional[str] = None
    dateB: Optional[str] = None
    collection: str = "auto"

class SARAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    productId: Optional[str] = None

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Agro Consultas Geospatial Forest API",
        "version": "2.1.0",
        "stacCatalog": "https://earth-search.aws.element84.com/v1/",
        "endpoints": [
            "/api/forest/lots",
            "/api/forest/stac",
            "/api/forest/ndvi",
            "/api/forest/sar",
            "/api/forest/changes",
            "/api/forest/analyze"
        ]
    }

@app.get("/api/forest/lots")
def get_sample_lots():
    """Retorna respuesta informativa sobre soporte de lotes: no hay lotes de ejemplo predeterminados"""
    return []

def _stac_asset_calibration(asset):
    """Extrae escala, offset y resolución publicados en raster:bands."""
    bands = asset.get("raster:bands") or []
    band = bands[0] if bands else {}
    scale = band.get("scale")
    offset = band.get("offset")
    resolution = band.get("spatial_resolution")
    try:
        scale = float(scale) if scale is not None else None
        offset = float(offset) if offset is not None else None
        resolution = float(resolution) if resolution is not None else None
    except (TypeError, ValueError):
        return None, None, None
    return scale, offset, resolution


@app.post("/api/forest/stac")
def search_stac_catalog(req: STACSearchRequest):
    """Consulta Sentinel-2 L2A o Landsat 8/9 C2 L2 con geometría exacta y radiometría STAC."""
    try:
        collection = req.collection or "sentinel-2-l2a"
        if collection not in ("sentinel-2-l2a", "landsat-c2-l2"):
            raise HTTPException(status_code=400, detail="Colección STAC no permitida.")

        start_def, date_a_def, date_b_def = get_default_dates()
        s_date = req.startDate or start_def
        e_date = req.endDate or date_b_def
        geom_dict = get_geom_dict(req.geometry)
        validate_geometry_shape(geom_dict)

        search_body = {
            "collections": [collection],
            "intersects": geom_dict,
            "datetime": f"{s_date}T00:00:00Z/{e_date}T23:59:59Z",
            "limit": 30,
            "query": {"eo:cloud_cover": {"lte": req.maxCloudCover}}
        }
        stac_url = EARTH_SEARCH_STAC_URL if collection == "sentinel-2-l2a" else PLANETARY_COMPUTER_STAC_URL
        headers = {"Accept": "application/geo+json, application/json"}
        if req.productId:
            # Fetch the exact STAC item by ID; do not rely on a truncated search page.
            item_url = stac_url.rsplit("/search", 1)[0] + (
                f"/collections/{urllib.parse.quote(collection, safe='')}/items/{urllib.parse.quote(req.productId, safe='')}"
            )
            aws_req = urllib.request.Request(item_url, headers=headers)
            with urllib.request.urlopen(aws_req, timeout=15) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"El proveedor STAC respondió HTTP {resp.status}")
                item = json.loads(resp.read().decode("utf-8"))
            data = {"features": [item] if item.get("type") == "Feature" else []}
        else:
            req_data = json.dumps(search_body).encode("utf-8")
            aws_req = urllib.request.Request(
                stac_url,
                data=req_data,
                headers={**headers, "Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(aws_req, timeout=15) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"El proveedor STAC respondió HTTP {resp.status}")
                data = json.loads(resp.read().decode("utf-8"))

        features = data.get("features", [])
        retrieved_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        parsed_products = []
        calibration_rejected = 0
        platform_rejected = 0

        for feat in features:
            props = feat.get("properties", {})
            platform = props.get("platform")
            actual_datetime = props.get("datetime") or props.get("start_datetime")
            if req.productId:
                actual_day = actual_datetime[:10] if isinstance(actual_datetime, str) else None
                if actual_day is None or not (s_date <= actual_day <= e_date):
                    continue

            if collection == "landsat-c2-l2" and platform not in ("landsat-8", "landsat-9"):
                platform_rejected += 1
                continue

            item_assets = feat.get("assets", {})
            red_asset = item_assets.get("red")
            if collection == "sentinel-2-l2a":
                nir_asset = item_assets.get("nir")
                scl_asset = item_assets.get("scl")
                qa_asset = None
                quality_asset = scl_asset
                quality_kind = "scl"
                product_name = "Sentinel-2 L2A Surface Reflectance"
                source_name = "Copernicus Sentinel-2 / AWS Earth Search STAC"
                bands = ["B04 (Red)", "B08 (NIR)"]
            else:
                nir_asset = item_assets.get("nir08")
                scl_asset = None
                qa_asset = item_assets.get("qa_pixel")
                quality_asset = qa_asset
                quality_kind = "qa_pixel"
                product_name = "Landsat Collection 2 Level-2 Surface Reflectance"
                source_name = "USGS Landsat 8/9 / Microsoft Planetary Computer STAC"
                bands = ["SR_B4 (Red)", "SR_B5 (NIR)"]

            if not red_asset or not nir_asset or not quality_asset:
                continue

            red_href = red_asset.get("href")
            nir_href = nir_asset.get("href")
            quality_href = quality_asset.get("href")
            if not red_href or not nir_href or not quality_href:
                continue

            red_scale, red_offset, red_resolution = _stac_asset_calibration(red_asset)
            nir_scale, nir_offset, nir_resolution = _stac_asset_calibration(nir_asset)
            if None in (red_scale, red_offset, nir_scale, nir_offset):
                calibration_rejected += 1
                continue

            raw_cc = props.get("eo:cloud_cover")
            try:
                cloud_cover_val = round(float(raw_cc), 2) if raw_cc is not None else None
            except (TypeError, ValueError):
                cloud_cover_val = None

            actual_date = props.get("datetime")
            parsed_products.append({
                "id": feat.get("id"),
                "date": actual_date.split("T")[0] if actual_date else None,
                "acquiredAt": actual_date,
                "publishedAt": props.get("created"),
                "cloudCover": cloud_cover_val,
                "cloudCoverDisplay": f"{cloud_cover_val}%" if cloud_cover_val is not None else "NO REGISTRADO",
                "collection": collection,
                "sensor": platform,
                "product": product_name,
                "source": source_name,
                "sourceUrl": (
                    f"https://earth-search.aws.element84.com/v1/collections/{collection}"
                    if collection == "sentinel-2-l2a"
                    else f"https://planetarycomputer.microsoft.com/api/stac/v1/collections/{collection}"
                ),
                "resolution": red_resolution,
                "bands": bands,
                "geometry": feat.get("geometry"),
                "coverage": feat.get("bbox"),
                "crs": props.get("proj:code") or (
                    f"EPSG:{props.get('proj:epsg')}" if props.get("proj:epsg") is not None else None
                ),
                "resolutionUnit": "m" if red_resolution is not None else None,
                "status": "AVAILABLE",
                "limitations": ["Metadatos STAC de escena; las estadísticas se calculan al procesar los activos ráster."],
                "retrievedAt": retrieved_at,
                "quality": {
                    "eo:cloud_cover": cloud_cover_val,
                    "landsat:collection_category": props.get("landsat:collection_category"),
                    "qualityMaskAsset": quality_kind
                },
                "license": (
                    "Public domain (USGS Landsat); attribution recommended."
                    if collection == "landsat-c2-l2" else None
                ),
                "assets": {
                    "red": red_href,
                    "nir": nir_href,
                    "scl": scl_asset.get("href") if scl_asset else None,
                    "qaPixel": qa_asset.get("href") if qa_asset else None,
                    "qualityMaskAsset": quality_kind,
                    "redScale": red_scale,
                    "redOffset": red_offset,
                    "nirScale": nir_scale,
                    "nirOffset": nir_offset,
                    "redResolution": red_resolution,
                    "nirResolution": nir_resolution,
                    "visual": item_assets.get("visual", {}).get("href"),
                    "thumbnail": item_assets.get("thumbnail", {}).get("href"),
                    "spectralBands": {
                        name: {
                            "href": item_assets.get(asset_name, {}).get("href"),
                            "scale": _stac_asset_calibration(item_assets.get(asset_name, {}))[0],
                            "offset": _stac_asset_calibration(item_assets.get(asset_name, {}))[1],
                            "resolution": _stac_asset_calibration(item_assets.get(asset_name, {}))[2]
                        }
                        for name, asset_name in (
                            ("blue", "blue"), ("green", "green"), ("red", "red"),
                            ("nir", "nir" if collection == "sentinel-2-l2a" else "nir08"),
                            ("rededge1", "rededge1"), ("swir16", "swir16"), ("swir22", "swir22")
                        )
                        if item_assets.get(asset_name, {}).get("href")
                    }
                }
            })

        parsed_products.sort(key=lambda item: item["cloudCover"] if item["cloudCover"] is not None else 999.0)
        if parsed_products:
            return {
                "success": True,
                "source": parsed_products[0]["source"],
                "collection": collection,
                "productsCount": len(parsed_products),
                "retrievedAt": retrieved_at,
                "bestProduct": parsed_products[0],
                "products": parsed_products,
                "calibrationRejectedCount": calibration_rejected,
                "platformRejectedCount": platform_rejected
            }

        return {
            "success": False,
            "source": "AWS Earth Search / Microsoft Planetary Computer STAC",
            "collection": collection,
            "productsCount": 0,
            "retrievedAt": retrieved_at,
            "bestProduct": None,
            "products": [],
            "calibrationRejectedCount": calibration_rejected,
            "platformRejectedCount": platform_rejected,
            "message": "No se encontraron escenas con bandas RED/NIR, máscara de calidad y calibración radiométrica completa para la geometría y período solicitados."
        }
    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "source": "AWS Earth Search STAC",
            "collection": req.collection,
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "message": f"No se pudo consultar el catálogo STAC: {str(e)}"
        }


def _project_roi_geometry(geometry, transformer):
    """Reproyecta toda la geometría, conservando MultiPolygon y anillos interiores."""
    return transform_geometry(lambda x, y, z=None: transformer.transform(x, y), geometry)


def calculate_scaled_ndvi(red_dn, nir_dn, red_scale, red_offset, nir_scale, nir_offset):
    """Calcula NDVI sobre reflectancia calibrada, no sobre DN enteros."""
    red_reflectance = float(red_dn) * float(red_scale) + float(red_offset)
    nir_reflectance = float(nir_dn) * float(nir_scale) + float(nir_offset)
    denominator = nir_reflectance + red_reflectance
    if not math.isfinite(denominator) or abs(denominator) <= 1e-8:
        return None
    value = (nir_reflectance - red_reflectance) / denominator
    return value if math.isfinite(value) else None


def is_sentinel2_scl_clear(value):
    """Clases SCL excluidas: NoData, saturado/defectuoso, sombra, nubes y nieve."""
    try:
        return int(value) not in {0, 1, 3, 8, 9, 10, 11}
    except (TypeError, ValueError):
        return False


def is_landsat_qa_pixel_clear(value):
    """QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, shadow and snow."""
    try:
        return (int(value) & 0b111111) == 0
    except (TypeError, ValueError):
        return False


def _process_cog_raster_ndvi_cropped_impl(
    red_url, nir_url, scl_url, geom_shape,
    red_scale=1.0, red_offset=0.0, nir_scale=1.0, nir_offset=0.0,
    qa_pixel_url=None
):
    """
    Recorta RED/NIR, aplica calibración STAC y máscaras SCL/QA_PIXEL.
    Reproyecta máscaras con nearest-neighbour y bandas espectrales con bilinear.
    """
    try:
        import rasterio
        from rasterio.mask import mask as rasterio_mask
        from rasterio.warp import reproject, Resampling
        import pyproj

        red_scale = float(red_scale)
        red_offset = float(red_offset)
        nir_scale = float(nir_scale)
        nir_offset = float(nir_offset)
        if not all(math.isfinite(v) for v in (red_scale, red_offset, nir_scale, nir_offset)):
            return None, "La calibración radiométrica STAC es inválida."

        with rasterio.open(red_url) as src_red, rasterio.open(nir_url) as src_nir:
            transformer = pyproj.Transformer.from_crs('EPSG:4326', src_red.crs, always_xy=True)
            geom_proj = _project_roi_geometry(geom_shape, transformer)

            if geom_shape.geom_type == 'Point':
                row_r, col_r = src_red.index(geom_proj.x, geom_proj.y)
                if row_r < 0 or col_r < 0 or row_r >= src_red.height or col_r >= src_red.width:
                    return None, "El punto está fuera de la escena RED."
                val_red = src_red.read(1, window=rasterio.windows.Window(col_r, row_r, 1, 1))[0, 0]

                if src_nir.crs == src_red.crs:
                    pt_x_n, pt_y_n = geom_proj.x, geom_proj.y
                else:
                    transformer_nir_pt = pyproj.Transformer.from_crs('EPSG:4326', src_nir.crs, always_xy=True)
                    pt_x_n, pt_y_n = transformer_nir_pt.transform(geom_shape.x, geom_shape.y)
                row_n, col_n = src_nir.index(pt_x_n, pt_y_n)
                if row_n < 0 or col_n < 0 or row_n >= src_nir.height or col_n >= src_nir.width:
                    return None, "El punto está fuera de la escena NIR."
                val_nir = src_nir.read(1, window=rasterio.windows.Window(col_n, row_n, 1, 1))[0, 0]

                if (src_red.nodata is not None and val_red == src_red.nodata) or val_red <= 0:
                    return None, "El punto RED es NoData."
                if (src_nir.nodata is not None and val_nir == src_nir.nodata) or val_nir <= 0:
                    return None, "El punto NIR es NoData."

                scl_filter_applied = False
                scl_warning = "Asset SCL no proporcionado; el procesador no aplicó máscara de calidad."
                if scl_url:
                    try:
                        with rasterio.open(scl_url) as src_scl:
                            transformer_scl = pyproj.Transformer.from_crs('EPSG:4326', src_scl.crs, always_xy=True)
                            scl_x, scl_y = transformer_scl.transform(geom_shape.x, geom_shape.y)
                            row_scl, col_scl = src_scl.index(scl_x, scl_y)
                            if row_scl < 0 or col_scl < 0 or row_scl >= src_scl.height or col_scl >= src_scl.width:
                                return None, "El punto está fuera de la máscara SCL."
                            scl_value = src_scl.read(1, window=rasterio.windows.Window(col_scl, row_scl, 1, 1))[0, 0]
                            if src_scl.nodata is not None and scl_value == src_scl.nodata:
                                return None, "El punto tiene SCL NoData."
                            if not is_sentinel2_scl_clear(scl_value):
                                return None, f"El píxel fue excluido por la clase SCL {int(scl_value)}."
                            scl_filter_applied = True
                            scl_warning = None
                    except Exception as scl_error:
                        scl_warning = f"No se pudo cargar o alinear la máscara SCL: {scl_error}"

                qa_pixel_filter_applied = False
                qa_pixel_warning = "Asset QA_PIXEL no proporcionado."
                if qa_pixel_url:
                    try:
                        with rasterio.open(qa_pixel_url) as src_qa:
                            transformer_qa = pyproj.Transformer.from_crs('EPSG:4326', src_qa.crs, always_xy=True)
                            qa_x, qa_y = transformer_qa.transform(geom_shape.x, geom_shape.y)
                            row_qa, col_qa = src_qa.index(qa_x, qa_y)
                            if row_qa < 0 or col_qa < 0 or row_qa >= src_qa.height or col_qa >= src_qa.width:
                                return None, "El punto está fuera de la máscara Landsat QA_PIXEL."
                            qa_value = src_qa.read(1, window=rasterio.windows.Window(col_qa, row_qa, 1, 1))[0, 0]
                            if (src_qa.nodata is not None and qa_value == src_qa.nodata) or not is_landsat_qa_pixel_clear(qa_value):
                                return None, f"El píxel fue excluido por QA_PIXEL (valor {int(qa_value)})."
                            qa_pixel_filter_applied = True
                            qa_pixel_warning = None
                    except Exception as qa_error:
                        qa_pixel_warning = f"No se pudo cargar o alinear QA_PIXEL: {qa_error}"

                quality_masks = []
                if scl_filter_applied:
                    quality_masks.append("Sentinel-2 SCL")
                if qa_pixel_filter_applied:
                    quality_masks.append("Landsat QA_PIXEL")
                quality_mask_applied = bool(quality_masks)
                quality_mask_type = " + ".join(quality_masks) if quality_masks else "No aplicada"

                ndvi_pt = calculate_scaled_ndvi(
                    val_red, val_nir, red_scale, red_offset, nir_scale, nir_offset
                )
                if ndvi_pt is None:
                    return None, "Reflectancia calibrada con denominador NDVI inválido."
                ndvi_pt = round(float(ndvi_pt), 4)
                return {
                    "min": ndvi_pt,
                    "max": ndvi_pt,
                    "mean": ndvi_pt,
                    "median": ndvi_pt,
                    "stdDev": 0.0,
                    "validPixelsPercent": 100.0,
                    "sampleCount": 1,
                    "isPoint": True,
                    "sclFilterApplied": scl_filter_applied,
                    "sclWarning": scl_warning,
                    "qaPixelFilterApplied": qa_pixel_filter_applied,
                    "qaPixelWarning": qa_pixel_warning,
                    "qualityMaskApplied": quality_mask_applied,
                    "qualityMaskType": quality_mask_type,
                    "reflectanceScalingApplied": True,
                    "redScale": red_scale,
                    "redOffset": red_offset,
                    "nirScale": nir_scale,
                    "nirOffset": nir_offset
                }, None

            out_red, transform_red = rasterio_mask(
                src_red, [geom_proj], crop=True, nodata=src_red.nodata
            )
            red_data = out_red[0]
            red_nodata = src_red.nodata if src_red.nodata is not None else 0
            roi_mask = (red_data != red_nodata) & (red_data > 0)
            roi_pixel_count = int(np.sum(roi_mask))
            if roi_pixel_count == 0:
                return None, "La geometría no contiene píxeles RED válidos."

            if src_nir.crs == src_red.crs:
                geom_proj_nir = geom_proj
            else:
                transformer_nir = pyproj.Transformer.from_crs('EPSG:4326', src_nir.crs, always_xy=True)
                geom_proj_nir = _project_roi_geometry(geom_shape, transformer_nir)

            out_nir_raw, transform_nir = rasterio_mask(
                src_nir, [geom_proj_nir], crop=True, nodata=src_nir.nodata
            )
            nir_raw = out_nir_raw[0]

            if (src_red.crs == src_nir.crs and
                src_red.transform == src_nir.transform and
                nir_raw.shape == red_data.shape):
                nir_aligned = nir_raw
            else:
                nir_nodata_value = src_nir.nodata if src_nir.nodata is not None else 0
                nir_aligned = np.full(
                    red_data.shape, nir_nodata_value, dtype=nir_raw.dtype
                )
                reproject(
                    source=nir_raw,
                    destination=nir_aligned,
                    src_transform=transform_nir,
                    src_crs=src_nir.crs,
                    dst_transform=transform_red,
                    dst_crs=src_red.crs,
                    resampling=Resampling.bilinear,
                    src_nodata=src_nir.nodata,
                    dst_nodata=nir_nodata_value
                )

            scl_aligned = None
            scl_filter_applied = False
            scl_warning = "Asset SCL no proporcionado; el procesador no aplicó máscara de calidad."
            if scl_url:
                try:
                    with rasterio.open(scl_url) as src_scl:
                        if src_scl.crs == src_red.crs:
                            geom_proj_scl = geom_proj
                        else:
                            transformer_scl = pyproj.Transformer.from_crs('EPSG:4326', src_scl.crs, always_xy=True)
                            geom_proj_scl = _project_roi_geometry(geom_shape, transformer_scl)

                        out_scl_raw, transform_scl = rasterio_mask(
                            src_scl, [geom_proj_scl], crop=True, nodata=src_scl.nodata
                        )
                        scl_raw = out_scl_raw[0]

                        if (src_scl.crs == src_red.crs and
                            src_scl.transform == src_red.transform and
                            scl_raw.shape == red_data.shape):
                            scl_aligned = scl_raw
                        else:
                            scl_aligned = np.zeros(red_data.shape, dtype=scl_raw.dtype)
                            reproject(
                                source=scl_raw,
                                destination=scl_aligned,
                                src_transform=transform_scl,
                                src_crs=src_scl.crs,
                                dst_transform=transform_red,
                                dst_crs=src_red.crs,
                                resampling=Resampling.nearest,
                                src_nodata=src_scl.nodata,
                                dst_nodata=0
                            )
                        scl_filter_applied = True
                        scl_warning = None
                except Exception as scl_error:
                    scl_warning = f"No se pudo cargar o alinear la máscara SCL: {scl_error}"

            qa_aligned = None
            qa_nodata_value = 1
            qa_pixel_filter_applied = False
            qa_pixel_warning = "Asset QA_PIXEL no proporcionado."
            if qa_pixel_url:
                try:
                    with rasterio.open(qa_pixel_url) as src_qa:
                        qa_nodata_value = src_qa.nodata if src_qa.nodata is not None else 1
                        if src_qa.crs == src_red.crs:
                            geom_proj_qa = geom_proj
                        else:
                            transformer_qa = pyproj.Transformer.from_crs('EPSG:4326', src_qa.crs, always_xy=True)
                            geom_proj_qa = _project_roi_geometry(geom_shape, transformer_qa)

                        out_qa_raw, transform_qa = rasterio_mask(
                            src_qa, [geom_proj_qa], crop=True, nodata=src_qa.nodata
                        )
                        qa_raw = out_qa_raw[0]
                        if (src_qa.crs == src_red.crs and
                            src_qa.transform == src_red.transform and
                            qa_raw.shape == red_data.shape):
                            qa_aligned = qa_raw
                        else:
                            qa_aligned = np.full(red_data.shape, qa_nodata_value, dtype=qa_raw.dtype)
                            reproject(
                                source=qa_raw,
                                destination=qa_aligned,
                                src_transform=transform_qa,
                                src_crs=src_qa.crs,
                                dst_transform=transform_red,
                                dst_crs=src_red.crs,
                                resampling=Resampling.nearest,
                                src_nodata=src_qa.nodata,
                                dst_nodata=qa_nodata_value
                            )
                        qa_pixel_filter_applied = True
                        qa_pixel_warning = None
                except Exception as qa_error:
                    qa_pixel_warning = f"No se pudo cargar o alinear QA_PIXEL: {qa_error}"

            nir_nodata = src_nir.nodata if src_nir.nodata is not None else 0
            valid_red = (red_data != red_nodata) & (red_data > 0)
            valid_nir = (nir_aligned != nir_nodata) & (nir_aligned > 0)
            red_reflectance = red_data.astype(np.float64) * red_scale + red_offset
            nir_reflectance = nir_aligned.astype(np.float64) * nir_scale + nir_offset
            denominator = nir_reflectance + red_reflectance

            scl_excluded = (
                np.isin(scl_aligned, [0, 1, 3, 8, 9, 10, 11])
                if scl_aligned is not None else np.zeros(red_data.shape, dtype=bool)
            )
            qa_excluded = (
                ((qa_aligned.astype(np.uint16) & 0b111111) != 0) |
                (qa_aligned == qa_nodata_value)
                if qa_aligned is not None else np.zeros(red_data.shape, dtype=bool)
            )
            quality_masks = []
            if scl_filter_applied:
                quality_masks.append("Sentinel-2 SCL")
            if qa_pixel_filter_applied:
                quality_masks.append("Landsat QA_PIXEL")
            quality_mask_applied = bool(quality_masks)
            quality_mask_type = " + ".join(quality_masks) if quality_masks else "No aplicada"
            valid = (
                valid_red & valid_nir & (~scl_excluded) & (~qa_excluded) &
                np.isfinite(red_reflectance) & np.isfinite(nir_reflectance) &
                np.isfinite(denominator) & (np.abs(denominator) > 1e-8)
            )

            ndvi_array = np.full(red_data.shape, np.nan, dtype=np.float64)
            ndvi_array[valid] = (
                nir_reflectance[valid] - red_reflectance[valid]
            ) / denominator[valid]
            valid_ndvi = ndvi_array[np.isfinite(ndvi_array)]
            if len(valid_ndvi) == 0:
                return None, "No se obtuvieron píxeles válidos libres de nubes/sombras dentro del lote."

            min_val = round(float(np.min(valid_ndvi)), 4)
            max_val = round(float(np.max(valid_ndvi)), 4)
            mean_val = round(float(np.mean(valid_ndvi)), 4)
            median_val = round(float(np.median(valid_ndvi)), 4)
            std_val = round(float(np.std(valid_ndvi)), 4)
            valid_pct = round((float(len(valid_ndvi)) / float(roi_pixel_count)) * 100.0, 1)
            clean_matrix = np.where(np.isfinite(ndvi_array), ndvi_array, None).tolist()

            return {
                "min": min_val,
                "max": max_val,
                "mean": mean_val,
                "median": median_val,
                "stdDev": std_val,
                "validPixelsPercent": valid_pct,
                "sampleCount": int(len(valid_ndvi)),
                "roiPixelCount": int(roi_pixel_count),
                "sclFilterApplied": scl_filter_applied,
                "sclWarning": scl_warning,
                "qaPixelFilterApplied": qa_pixel_filter_applied,
                "qaPixelWarning": qa_pixel_warning,
                "qualityMaskApplied": quality_mask_applied,
                "qualityMaskType": quality_mask_type,
                "reflectanceScalingApplied": True,
                "redScale": red_scale,
                "redOffset": red_offset,
                "nirScale": nir_scale,
                "nirOffset": nir_offset,
                "crs": str(src_red.crs),
                "transform": list(transform_red)[:6],
                "shape": list(red_data.shape),
                "ndviMatrix": clean_matrix,
                "isPoint": False
            }, None

    except Exception as e:
        return None, str(e)


def process_cog_raster_ndvi_cropped(
    red_url, nir_url, scl_url, geom_shape,
    red_scale=1.0, red_offset=0.0, nir_scale=1.0, nir_offset=0.0,
    qa_pixel_url=None
):
    """Procesa COGs públicos S3/HTTPS sin requerir credenciales AWS."""
    import rasterio
    with rasterio.Env(AWS_NO_SIGN_REQUEST="YES"):
        return _process_cog_raster_ndvi_cropped_impl(
            red_url, nir_url, scl_url, geom_shape,
            red_scale=red_scale,
            red_offset=red_offset,
            nir_scale=nir_scale,
            nir_offset=nir_offset,
            qa_pixel_url=qa_pixel_url
        )


@app.post("/api/forest/ndvi")
def calculate_ndvi(req: NDVIAnalysisRequest):
    """Calcula NDVI con Sentinel-2 o Landsat 8/9 y exige una máscara de calidad válida."""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        target_date = req.date or date_b_def
        target_dt = datetime.datetime.strptime(target_date, "%Y-%m-%d")
        start_range = (target_dt - datetime.timedelta(days=45)).strftime("%Y-%m-%d")
        end_range = target_dt.strftime("%Y-%m-%d")

        geom_dict = get_geom_dict(req.geometry)
        geom_shape = validate_geometry_shape(geom_dict)
        if geom_shape.geom_type == "Point":
            area_ha = 0.0
            is_point = True
        else:
            area_ha = round(calculate_shapely_area(geom_shape) / 10000.0, 2)
            is_point = False

        allowed_collections = ("sentinel-2-l2a", "landsat-c2-l2")
        if req.collection == "auto":
            collections_to_try = list(allowed_collections)
        elif req.collection in allowed_collections:
            collections_to_try = [req.collection]
        else:
            raise HTTPException(status_code=400, detail="Colección NDVI no permitida.")

        selected_product = None
        selected_stats = None
        selected_error = None
        attempts = []

        for collection in collections_to_try:
            max_cloud = 30.0 if collection == "sentinel-2-l2a" else 100.0
            stac_result = search_stac_catalog(STACSearchRequest(
                geometry=req.geometry,
                startDate=start_range,
                endDate=end_range,
                maxCloudCover=max_cloud,
                collection=collection,
                productId=req.productId
            ))
            products = stac_result.get("products", [])
            if req.productId:
                products = [item for item in products if item.get("id") == req.productId]

            if not products:
                attempts.append({
                    "collection": collection,
                    "status": "NO_SCENES",
                    "message": stac_result.get("message", "No se encontraron escenas calibradas.")
                })
                continue

            for candidate in products[:5]:
                assets = candidate.get("assets") or {}
                red_url = assets.get("red")
                nir_url = assets.get("nir")
                qa_pixel_url = assets.get("qaPixel")
                if collection == "landsat-c2-l2":
                    try:
                        red_url = _sign_planetary_computer_asset(red_url)
                        nir_url = _sign_planetary_computer_asset(nir_url)
                        qa_pixel_url = _sign_planetary_computer_asset(qa_pixel_url)
                    except Exception as sign_error:
                        selected_error = f"No se pudieron firmar los assets Landsat: {sign_error}"
                        continue

                stats, error_message = process_cog_raster_ndvi_cropped(
                    red_url,
                    nir_url,
                    assets.get("scl"),
                    geom_shape,
                    red_scale=assets.get("redScale", 1.0),
                    red_offset=assets.get("redOffset", 0.0),
                    nir_scale=assets.get("nirScale", 1.0),
                    nir_offset=assets.get("nirOffset", 0.0),
                    qa_pixel_url=qa_pixel_url
                )
                if stats and stats.get("qualityMaskApplied"):
                    selected_product = candidate
                    selected_stats = stats
                    break
                selected_error = error_message or (stats or {}).get("sclWarning") or (stats or {}).get("qaPixelWarning")
            if selected_product:
                break
            attempts.append({
                "collection": collection,
                "status": "NO_VALID_PIXELS",
                "message": selected_error or "Las escenas encontradas no produjeron píxeles válidos con máscara de calidad."
            })

        if not selected_product or not selected_stats:
            return {
                "indicator": "NDVI (Índice de Vegetación)",
                "date": target_date,
                "requestedDate": target_date,
                "areaHectares": area_ha,
                "isPoint": is_point,
                "status": "UNAVAILABLE",
                "source": "Copernicus Sentinel-2 / USGS Landsat 8/9 vía AWS Earth Search STAC",
                "message": "No se obtuvieron píxeles NDVI válidos con máscara de calidad en Sentinel-2 ni Landsat 8/9 para el período consultado.",
                "attempts": attempts,
                "details": selected_error
            }

        mean_val = selected_stats["mean"]
        actual_date = selected_product.get("date") or target_date
        cloud_pct = selected_product.get("cloudCover")
        if mean_val >= 0.65:
            v_class = "Vegetación densa / vigor alto"
            desc = "La respuesta espectral NDVI es alta en los píxeles válidos observados."
        elif mean_val >= 0.35:
            v_class = "Vegetación moderada"
            desc = "La respuesta espectral NDVI es intermedia en los píxeles válidos observados."
        elif mean_val >= 0.15:
            v_class = "Vegetación escasa"
            desc = "La respuesta espectral NDVI es baja en los píxeles válidos observados."
        else:
            v_class = "Baja respuesta de vegetación"
            desc = "La respuesta espectral NDVI es muy baja; puede corresponder a suelo, agua, cobertura escasa u otras condiciones."

        collection = selected_product.get("collection")
        quality_mask_type = selected_stats.get("qualityMaskType")
        limitations = [
            "NDVI es un índice espectral; no mide directamente biomasa, rendimiento, sanidad ni humedad del suelo.",
            "El resultado resume únicamente los píxeles válidos dentro de la geometría consultada."
        ]
        if collection == "landsat-c2-l2":
            limitations.append("Se enmascaran bits QA_PIXEL 0–5; QA_RADSAT no se aplica en esta versión.")
        else:
            limitations.append("Se excluyen clases SCL de NoData, saturación/defecto, sombra, nubes y nieve.")

        return {
            "indicator": "NDVI (Índice de Vegetación)",
            "date": actual_date,
            "requestedDate": target_date,
            "productId": selected_product.get("id"),
            "collection": collection,
            "sensor": selected_product.get("sensor"),
            "product": selected_product.get("product"),
            "source": selected_product.get("source"),
            "sourceUrl": selected_product.get("sourceUrl"),
            "license": selected_product.get("license"),
            "acquiredAt": selected_product.get("acquiredAt"),
            "publishedAt": selected_product.get("publishedAt"),
            "retrievedAt": selected_product.get("retrievedAt"),
            "geometry": selected_product.get("geometry"),
            "coverage": selected_product.get("coverage"),
            "crs": selected_product.get("crs"),
            "quality": selected_product.get("quality"),
            "spatialResolution": selected_product.get("resolution"),
            "resolutionUnit": "m",
            "qualityMaskType": quality_mask_type,
            "reflectanceScalingApplied": True,
            "bands": selected_product.get("bands"),
            "formula": "NDVI = (NIR_reflectance - RED_reflectance) / (NIR_reflectance + RED_reflectance); reflectance = DN × scale + offset",
            "cloudCover": f"{cloud_pct}%" if cloud_pct is not None else "NO REGISTRADO",
            "areaHectares": area_ha,
            "isPoint": is_point,
            "stats": selected_stats,
            "status": "REAL",
            "classification": v_class,
            "description": desc,
            "limitations": limitations,
            "message": f"NDVI calculado sobre reflectancia calibrada y máscara {quality_mask_type} (escena {selected_product.get('id')}, {actual_date}).",
            "details": f"Se procesaron COGs reales de {selected_product.get('product')} con escala y offset publicados por STAC."
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "indicator": "NDVI (Índice de Vegetación)",
            "date": req.date or get_default_dates()[2],
            "productId": None,
            "status": "UNAVAILABLE",
            "source": "Copernicus Sentinel-2 / USGS Landsat 8/9 vía AWS Earth Search STAC",
            "message": f"No se pudo calcular NDVI: {str(e)}"
        }



SPECTRAL_INDEX_DEFINITIONS = {
    "ndvi": {"label": "NDVI", "bands": ("nir", "red"), "formula": "(NIR - RED) / (NIR + RED)"},
    "evi": {"label": "EVI", "bands": ("nir", "red", "blue"), "formula": "2.5 × (NIR - RED) / (NIR + 6 RED - 7.5 BLUE + 1)"},
    "ndmi": {"label": "NDMI", "bands": ("nir", "swir16"), "formula": "(NIR - SWIR1) / (NIR + SWIR1)"},
    "gndvi": {"label": "GNDVI", "bands": ("nir", "green"), "formula": "(NIR - GREEN) / (NIR + GREEN)"},
    "ndre": {"label": "NDRE", "bands": ("nir", "rededge1"), "formula": "(NIR - Red Edge 1) / (NIR + Red Edge 1)"}
}


def _spectral_index_array(key, arrays):
    """Compute one documented spectral index from calibrated reflectance arrays."""
    if key == "ndvi":
        nir, red = arrays["nir"], arrays["red"]
        numerator, denominator = nir - red, nir + red
    elif key == "evi":
        nir, red, blue = arrays["nir"], arrays["red"], arrays["blue"]
        numerator = 2.5 * (nir - red)
        denominator = nir + 6.0 * red - 7.5 * blue + 1.0
    elif key == "ndmi":
        nir, swir = arrays["nir"], arrays["swir16"]
        numerator, denominator = nir - swir, nir + swir
    elif key == "gndvi":
        nir, green = arrays["nir"], arrays["green"]
        numerator, denominator = nir - green, nir + green
    elif key == "ndre":
        nir, rededge = arrays["nir"], arrays["rededge1"]
        numerator, denominator = nir - rededge, nir + rededge
    else:
        raise ValueError(f"Índice espectral no admitido: {key}")
    import numpy as np
    return np.divide(
        numerator,
        denominator,
        out=np.full_like(numerator, np.nan, dtype="float32"),
        where=np.abs(denominator) > 1e-8
    )


def _process_spectral_scene(candidate, geom_shape, requested_indices):
    """Calcula índices sobre reflectancia calibrada y una máscara QA alineada."""
    import numpy as np
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from rasterio.warp import reproject, Resampling
    from pyproj import Transformer

    assets = candidate.get("assets") or {}
    band_assets = assets.get("spectralBands") or {}
    available_indices = {
        key: definition for key, definition in SPECTRAL_INDEX_DEFINITIONS.items()
        if key in requested_indices and all(
            band in band_assets and band_assets[band].get("href") and
            band_assets[band].get("scale") is not None and band_assets[band].get("offset") is not None
            for band in definition["bands"]
        )
    }
    if not available_indices:
        return {}, "La escena no publica todos los assets espectrales calibrados requeridos."

    required_bands = sorted({band for item in available_indices.values() for band in item["bands"]})
    urls = {}
    for band in required_bands:
        url = band_assets[band]["href"]
        if candidate.get("collection") == "landsat-c2-l2":
            url = _sign_planetary_computer_asset(url)
        urls[band] = url

    # Usar la resolución más gruesa entre las bandas utilizadas evita presentar
    # índices SWIR/red-edge como si tuvieran detalle nativo de 10 m.
    datasets = {}
    try:
        for band, url in urls.items():
            datasets[band] = rasterio.open(url)
        reference_band = max(
            required_bands,
            key=lambda band: abs(datasets[band].transform.a * datasets[band].transform.e)
        )
        reference = datasets[reference_band]
        transformer = Transformer.from_crs("EPSG:4326", reference.crs, always_xy=True)
        geom_projected = transform_geometry(
            lambda x, y, z=None: transformer.transform(x, y), geom_shape
        )
        reference_data, out_transform = rasterio_mask(
            reference, [mapping(geom_projected)], crop=True, filled=False
        )
        if reference_data.size > 2_000_000:
            raise ValueError("El lote supera el límite de 2 millones de píxeles por consulta.")
        height, width = reference_data.shape[-2:]
        base_mask = np.ma.getmaskarray(reference_data[0]).copy()
        arrays = {}
        for band in required_bands:
            source = datasets[band]
            if band == reference_band:
                raw = np.ma.filled(reference_data[0], np.nan).astype("float32")
            else:
                raw = np.full((height, width), np.nan, dtype="float32")
                reproject(
                    source=rasterio.band(source, 1),
                    destination=raw,
                    src_transform=source.transform,
                    src_crs=source.crs,
                    src_nodata=source.nodata,
                    dst_transform=out_transform,
                    dst_crs=reference.crs,
                    dst_nodata=np.nan,
                    resampling=Resampling.bilinear
                )
            calibration = band_assets[band]
            arrays[band] = raw * float(calibration["scale"]) + float(calibration["offset"])
            if source.nodata is not None and band == reference_band:
                base_mask |= np.ma.getmaskarray(reference_data[0])

        quality_mask_type = "SCL" if candidate.get("collection") == "sentinel-2-l2a" else "QA_PIXEL"
        quality_href = assets.get("scl") if quality_mask_type == "SCL" else assets.get("qaPixel")
        if not quality_href:
            raise ValueError("La escena no publica una máscara de calidad.")
        if candidate.get("collection") == "landsat-c2-l2":
            quality_href = _sign_planetary_computer_asset(quality_href)
        with rasterio.open(quality_href) as quality_ds:
            quality = np.zeros((height, width), dtype="float32")
            reproject(
                source=rasterio.band(quality_ds, 1),
                destination=quality,
                src_transform=quality_ds.transform,
                src_crs=quality_ds.crs,
                src_nodata=quality_ds.nodata,
                dst_transform=out_transform,
                dst_crs=reference.crs,
                dst_nodata=0,
                resampling=Resampling.nearest
            )
        if quality_mask_type == "SCL":
            clear = np.isin(quality.astype("int16"), [2, 4, 5, 6, 7])
        else:
            clear = np.vectorize(is_landsat_qa_pixel_clear, otypes=[bool])(quality)
        common_valid = (~base_mask) & clear
        for array in arrays.values():
            common_valid &= np.isfinite(array)

        results = {
            key: {
                "status": "UNAVAILABLE",
                "message": "La colección o escena no publica todas las bandas calibradas necesarias para este índice."
            }
            for key in requested_indices if key not in available_indices
        }
        for key, definition in available_indices.items():
            index = _spectral_index_array(key, arrays)
            valid = common_valid & np.isfinite(index)
            values = index[valid]
            if not values.size:
                results[key] = {"status": "UNAVAILABLE", "message": "No quedaron píxeles válidos después de aplicar la máscara de calidad."}
                continue
            results[key] = {
                "status": "REAL",
                "label": definition["label"],
                "formula": definition["formula"],
                "bands": list(definition["bands"]),
                "mean": round(float(np.mean(values)), 5),
                "median": round(float(np.median(values)), 5),
                "min": round(float(np.min(values)), 5),
                "max": round(float(np.max(values)), 5),
                "stdDev": round(float(np.std(values)), 5),
                "sampleCount": int(values.size),
                "validPixelsPercent": round(float(values.size * 100 / max(1, height * width)), 2)
            }
        resolution = max(
            max(abs(datasets[band].res[0]), abs(datasets[band].res[1]))
            for band in required_bands
        )
        return {
            "indices": results,
            "qualityMask": quality_mask_type,
            "resolution": float(resolution),
            "resolutionUnit": "m",
            "gridShape": [height, width],
            "referenceCrs": str(reference.crs),
            "referenceBand": reference_band
        }, None
    finally:
        for dataset in datasets.values():
            dataset.close()


@app.post("/api/forest/spectral")
def calculate_spectral_indices(req: SpectralAnalysisRequest):
    """Procesa índices espectrales Sentinel-2/Landsat con reflectancia calibrada y QA."""
    try:
        unknown = sorted(set(req.indices) - set(SPECTRAL_INDEX_DEFINITIONS))
        if unknown:
            raise HTTPException(status_code=422, detail="Índices no admitidos: " + ", ".join(unknown))
        if not req.indices:
            raise HTTPException(status_code=422, detail="Seleccioná al menos un índice espectral.")
        target_date = req.date or get_default_dates()[2]
        target_dt = datetime.datetime.strptime(target_date, "%Y-%m-%d")
        start_range = (target_dt - datetime.timedelta(days=45)).strftime("%Y-%m-%d")
        allowed = ("sentinel-2-l2a", "landsat-c2-l2")
        if req.collection == "auto":
            collections = list(allowed)
        elif req.collection in allowed:
            collections = [req.collection]
        else:
            raise HTTPException(status_code=422, detail="Colección espectral no permitida.")
        geom_dict = get_geom_dict(req.geometry)
        geom_shape = validate_geometry_shape(geom_dict)
        attempts = []
        for collection in collections:
            cloud_limit = 30.0 if collection == "sentinel-2-l2a" else 100.0
            stac = search_stac_catalog(STACSearchRequest(
                geometry=req.geometry, startDate=start_range, endDate=target_date,
                maxCloudCover=cloud_limit, collection=collection, productId=req.productId
            ))
            candidates = stac.get("products") or []
            if req.productId:
                candidates = [item for item in candidates if item.get("id") == req.productId]
            for candidate in candidates[:5]:
                try:
                    processed, error = _process_spectral_scene(candidate, geom_shape, req.indices)
                except Exception as exc:
                    processed, error = None, str(exc)
                if processed and any(item.get("status") == "REAL" for item in processed["indices"].values()):
                    return {
                        "status": "REAL",
                        "indicator": "Índices espectrales",
                        "requestedDate": target_date,
                        "date": candidate.get("date"),
                        "productId": candidate.get("id"),
                        "collection": collection,
                        "sensor": candidate.get("sensor"),
                        "source": candidate.get("source"),
                        "sourceUrl": candidate.get("sourceUrl"),
                        "cloudCover": candidate.get("cloudCover"),
                        "resolution": processed["resolution"],
                        "resolutionUnit": processed["resolutionUnit"],
                        "qualityMask": processed["qualityMask"],
                        "gridShape": processed["gridShape"],
                        "indices": processed["indices"],
                        "limitations": [
                            "Los índices describen respuesta espectral y no equivalen a rendimiento cosechado, biomasa medida ni diagnóstico sanitario.",
                            "Las bandas de 20 m se procesan en una grilla común a la resolución más gruesa usada; no se atribuye detalle espacial adicional.",
                            "La máscara de calidad excluye píxeles no válidos, pero no elimina todos los efectos atmosféricos o de geometría de observación."
                        ]
                    }
            attempts.append({
                "collection": collection,
                "status": "NO_VALID_SCENE",
                "message": stac.get("message") or "No se encontró una escena con bandas y máscara de calidad válidas."
            })
        return {
            "status": "UNAVAILABLE",
            "indicator": "Índices espectrales",
            "requestedDate": target_date,
            "indices": {key: {"status": "UNAVAILABLE"} for key in req.indices},
            "attempts": attempts,
            "message": "No se obtuvieron estadísticas espectrales válidas para el área y período consultados."
        }
    except HTTPException:
        raise
    except Exception as exc:
        return {
            "status": "UNAVAILABLE",
            "indicator": "Índices espectrales",
            "requestedDate": req.date,
            "message": f"No se pudieron calcular los índices espectrales: {str(exc)[:300]}"
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

        allowed_collections = ("sentinel-2-l2a", "landsat-c2-l2")
        if req.collection == "auto":
            collections_to_try = list(allowed_collections)
        elif req.collection in allowed_collections:
            collections_to_try = [req.collection]
        else:
            raise HTTPException(status_code=400, detail="Colección de comparación no permitida.")

        # Ambas fechas deben usar el mismo sensor/colección: nunca mezclar S2 y Landsat en una comparación.
        ndvi_resA = None
        ndvi_resB = None
        for collection in collections_to_try:
            candidate_a = calculate_ndvi(NDVIAnalysisRequest(
                geometry=req.geometry, date=dA, collection=collection
            ))
            candidate_b = calculate_ndvi(NDVIAnalysisRequest(
                geometry=req.geometry, date=dB, collection=collection
            ))
            if candidate_a.get("status") == "REAL" and candidate_b.get("status") == "REAL":
                ndvi_resA, ndvi_resB = candidate_a, candidate_b
                break

        if ndvi_resA and ndvi_resB and ndvi_resA.get("status") == "REAL" and ndvi_resB.get("status") == "REAL":
            statsA = ndvi_resA.get("stats", {})
            statsB = ndvi_resB.get("stats", {})
            meanA = statsA.get("mean")
            meanB = statsB.get("mean")

            rawA = statsA.get("ndviMatrix")
            rawB = statsB.get("ndviMatrix")

            valid_diffs = None
            if rawA and rawB:
                crsA = statsA.get("crs")
                crsB = statsB.get("crs")
                trA = statsA.get("transform")
                trB = statsB.get("transform")

                # Verificar correspondencia exacta de CRS y transformadas de grilla espacial entre fechas
                grid_matches = (
                    crsA is not None and crsB is not None and crsA == crsB and
                    trA is not None and trB is not None and trA == trB
                )

                matA = np.array(rawA, dtype=float)
                matB = np.array(rawB, dtype=float)

                if grid_matches and matA.shape == matB.shape and matA.size > 0:
                    diff_matrix = matB - matA
                    valid_mask = (~np.isnan(diff_matrix)) & (matA != None) & (matB != None)
                    diffs_arr = diff_matrix[valid_mask]
                    if len(diffs_arr) > 0:
                        valid_diffs = diffs_arr

            if valid_diffs is not None and len(valid_diffs) > 0:
                dec_px = np.sum(valid_diffs <= -0.15)
                inc_px = np.sum(valid_diffs >= 0.15)
                st_px = np.sum((valid_diffs > -0.15) & (valid_diffs < 0.15))
                total_valid = float(len(valid_diffs))

                dec_pct = round((dec_px / total_valid) * 100.0, 1)
                inc_pct = round((inc_px / total_valid) * 100.0, 1)
                st_pct = round((st_px / total_valid) * 100.0, 1)

                if is_point:
                    dec_ha, st_ha, inc_ha = 0.0, 0.0, 0.0
                else:
                    dec_ha = round((dec_pct / 100.0) * area_ha, 2)
                    inc_ha = round((inc_pct / 100.0) * area_ha, 2)
                    st_ha = round(area_ha - dec_ha - inc_ha, 2)

                delta_ndvi = round(meanB - meanA, 4)

                if dec_pct > 30.0 or delta_ndvi <= -0.15:
                    classification = "DISMINUCION_SIGNIFICATIVA"
                    msg = f"Disminución significativa del índice de vegetación detectada (ΔNDVI: {delta_ndvi})."
                    desc = f"Se observa una disminución del NDVI en {dec_ha} ha ({dec_pct}% del lote). Puede responder a cambios de cobertura, manejo, estacionalidad u otros factores; requiere verificación de campo."
                elif inc_pct > 30.0 or delta_ndvi >= 0.15:
                    classification = "AUMENTO_SIGNIFICATIVO"
                    msg = f"Aumento significativo del índice de vegetación detectado (ΔNDVI: +{delta_ndvi})."
                    desc = f"Se observa un incremento de la respuesta NDVI en {inc_ha} ha ({inc_pct}% del lote)."
                else:
                    classification = "ESTABLE"
                    msg = f"Cobertura vegetativa estable entre ambas observaciones (ΔNDVI: {delta_ndvi})."
                    desc = f"El {st_pct}% de la superficie del lote ({st_ha} ha) permanece dentro del umbral de variación NDVI de ±0,15 utilizado por este análisis."

                return {
                    "period": {"dateA": ndvi_resA.get("date", dA), "dateB": ndvi_resB.get("date", dB)},
                    "deltaNDVI": delta_ndvi,
                    "ndviA": meanA,
                    "ndviB": meanB,
                    "totalAreaHa": area_ha,
                    "isPoint": is_point,
                    "status": "REAL",
                    "spatialComparisonAvailable": True,
                    "classification": classification,
                    "primaryMessage": msg,
                    "description": desc,
                    "breakdown": {
                        "decrease": {"hectares": dec_ha, "percent": dec_pct},
                        "stable": {"hectares": st_ha, "percent": st_pct},
                        "increase": {"hectares": inc_ha, "percent": inc_pct}
                    },
                    "collection": ndvi_resA.get("collection"),
                    "sensor": ndvi_resA.get("sensor"),
                    "spatialResolution": ndvi_resA.get("spatialResolution"),
                    "qualityMaskType": ndvi_resA.get("qualityMaskType"),
                    "source": ndvi_resA.get("source"),
                    "sourceUrl": ndvi_resA.get("sourceUrl"),
                    "license": ndvi_resA.get("license"),
                    "acquiredAt": {
                        "dateA": ndvi_resA.get("acquiredAt"),
                        "dateB": ndvi_resB.get("acquiredAt")
                    },
                    "limitations": list(dict.fromkeys(
                        (ndvi_resA.get("limitations") or []) + (ndvi_resB.get("limitations") or [])
                    )),
                    "products": {
                        "productA": ndvi_resA.get("productId"),
                        "productB": ndvi_resB.get("productId")
                    },
                    "disclaimer": "Las variaciones espectrales representan diferencias de reflectancia satelital calculadas píxel a píxel sobre el lote. No constituyen confirmación de tala o enfermedad sin inspección de terreno."
                }

            if meanA is not None and meanB is not None:
                delta_ndvi = round(meanB - meanA, 4)

                if delta_ndvi <= -0.15:
                    classification = "DISMINUCION_SIGNIFICATIVA"
                    msg = f"Disminución del índice de vegetación medio (ΔNDVI: {delta_ndvi})."
                    desc = "Se observa una reducción del NDVI medio entre ambas fechas; no equivale por sí sola a pérdida de biomasa o deterioro sanitario."
                elif delta_ndvi >= 0.15:
                    classification = "AUMENTO_SIGNIFICATIVO"
                    msg = f"Aumento del índice de vegetación medio (ΔNDVI: +{delta_ndvi})."
                    desc = "Se observa un incremento del NDVI medio entre ambas fechas; no equivale por sí solo a aumento de biomasa."
                else:
                    classification = "ESTABLE"
                    msg = f"Respuesta espectral media estable entre ambas observaciones (ΔNDVI: {delta_ndvi})."
                    desc = "La variación del NDVI medio se mantiene dentro del umbral de ±0,15 utilizado."

                return {
                    "period": {"dateA": ndvi_resA.get("date", dA), "dateB": ndvi_resB.get("date", dB)},
                    "deltaNDVI": delta_ndvi,
                    "ndviA": meanA,
                    "ndviB": meanB,
                    "totalAreaHa": area_ha,
                    "isPoint": is_point,
                    "status": "REAL",
                    "spatialComparisonAvailable": False,
                    "classification": classification,
                    "primaryMessage": msg,
                    "description": desc,
                    "breakdown": {
                        "decrease": {"hectares": "N/D (Comparación espacial píxel a píxel no disponible)", "percent": "N/D"},
                        "stable": {"hectares": "N/D (Comparación espacial píxel a píxel no disponible)", "percent": "N/D"},
                        "increase": {"hectares": "N/D (Comparación espacial píxel a píxel no disponible)", "percent": "N/D"}
                    },
                    "collection": ndvi_resA.get("collection"),
                    "sensor": ndvi_resA.get("sensor"),
                    "spatialResolution": ndvi_resA.get("spatialResolution"),
                    "qualityMaskType": ndvi_resA.get("qualityMaskType"),
                    "source": ndvi_resA.get("source"),
                    "sourceUrl": ndvi_resA.get("sourceUrl"),
                    "license": ndvi_resA.get("license"),
                    "acquiredAt": {
                        "dateA": ndvi_resA.get("acquiredAt"),
                        "dateB": ndvi_resB.get("acquiredAt")
                    },
                    "limitations": list(dict.fromkeys(
                        (ndvi_resA.get("limitations") or []) + (ndvi_resB.get("limitations") or [])
                    )),
                    "products": {
                        "productA": ndvi_resA.get("productId"),
                        "productB": ndvi_resB.get("productId")
                    },
                    "disclaimer": "Comparación espacial por píxeles no disponible debido a diferencia de dimensiones o grillas espectrales. Se reporta únicamente la variación entre las medias espectrales del lote."
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

@app.post("/api/forest/sar")
def get_sar_analysis(req: SARAnalysisRequest):
    """Consulta escenas Sentinel-1 reales y prueba las escenas disponibles hasta obtener píxeles válidos."""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        s_date = req.startDate or date_a_def
        e_date = req.endDate or date_b_def

        # Rechazar rangos inválidos antes de consultar el catálogo.
        try:
            start_day = datetime.date.fromisoformat(s_date)
            end_day = datetime.date.fromisoformat(e_date)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Fechas SAR inválidas. Usá el formato YYYY-MM-DD.")
        if start_day > end_day:
            raise HTTPException(status_code=400, detail="La fecha inicial SAR no puede ser posterior a la fecha final.")

        geom_dict = get_geom_dict(req.geometry)
        geom_shape = validate_geometry_shape(geom_dict)
        bounds = geom_shape.bounds

        if geom_shape.geom_type == 'Point':
            area_ha = 0.0
            is_point = True
        else:
            area_ha = round(calculate_shapely_area(geom_shape) / 10000.0, 2)
            is_point = False

        # STAC API: bbox e intersects son filtros espaciales alternativos y no deben enviarse juntos.
        # Enviar la geometría exacta del lote mediante intersects evita el HTTP 400 del catálogo.
        search_body = {
            "collections": ["sentinel-1-grd"],
            "intersects": geom_dict,
            "datetime": f"{s_date}T00:00:00Z/{e_date}T23:59:59Z",
            "limit": 100
        }

        if req.productId:
            item_url = EARTH_SEARCH_STAC_URL.rsplit("/search", 1)[0] + (
                f"/collections/sentinel-1-grd/items/{urllib.parse.quote(req.productId, safe='')}"
            )
            aws_req = urllib.request.Request(
                item_url,
                headers={'Accept': 'application/geo+json, application/json'}
            )
            with urllib.request.urlopen(aws_req, timeout=15) as resp:
                if resp.status != 200:
                    return {
                        "indicator": "Radar SAR Sentinel-1",
                        "date": e_date,
                        "productId": req.productId,
                        "areaHectares": area_ha,
                        "status": "UNAVAILABLE",
                        "message": f"El catálogo Sentinel-1 respondió HTTP {resp.status} al recuperar la escena solicitada."
                    }
                item = json.loads(resp.read().decode('utf-8'))
            data = {"features": [item] if item.get("type") == "Feature" else []}
        else:
            req_data = json.dumps(search_body).encode('utf-8')
            aws_req = urllib.request.Request(
                EARTH_SEARCH_STAC_URL,
                data=req_data,
                headers={'Content-Type': 'application/json', 'Accept': 'application/geo+json, application/json'},
                method="POST"
            )
            with urllib.request.urlopen(aws_req, timeout=15) as resp:
                if resp.status != 200:
                    return {
                        "indicator": "Radar SAR Sentinel-1",
                        "date": e_date,
                        "productId": None,
                        "areaHectares": area_ha,
                        "status": "UNAVAILABLE",
                        "message": f"El catálogo Sentinel-1 respondió HTTP {resp.status}."
                    }
                data = json.loads(resp.read().decode('utf-8'))

        features = data.get("features", [])
        if not features:
            return {
                "indicator": "Radar SAR Sentinel-1",
                "date": e_date,
                "productId": None,
                "areaHectares": area_ha,
                "status": "UNAVAILABLE",
                "source": "AWS Earth Search STAC (Sentinel-1 GRD)",
                "message": f"NO DISPONIBLE: No se encontraron escenas radar Sentinel-1 para el lote entre {s_date} y {e_date}."
            }

        # Probar escenas sucesivas: la primera puede carecer de polarizaciones o no cubrir píxeles válidos del lote.
        scene_errors = []
        for feat in features:
            props = feat.get("properties", {})
            assets = feat.get("assets", {})
            prod_id = feat.get("id")
            if req.productId and prod_id != req.productId:
                continue
            actual_date = props.get("datetime", "").split("T")[0] if props.get("datetime") else None
            if req.productId and (actual_date is None or not (s_date <= actual_date <= e_date)):
                scene_errors.append(f"{prod_id or 'escena'}: la fecha del ítem no coincide con el período solicitado")
                continue
            orbit_state = props.get("sat:orbit_state", "NO DISPONIBLE")
            vv_url = assets.get("vv", {}).get("href")
            vh_url = assets.get("vh", {}).get("href")
            vv_calibration = assets.get("schema-calibration-vv", {}).get("href")
            vh_calibration = assets.get("schema-calibration-vh", {}).get("href")
            vv_noise = assets.get("schema-noise-vv", {}).get("href")
            vh_noise = assets.get("schema-noise-vh", {}).get("href")

            if not all((vv_url, vh_url, vv_calibration, vh_calibration)):
                scene_errors.append(
                    f"{prod_id or 'escena sin ID'}: faltan mediciones VV/VH o LUT de calibración ESA por polarización"
                )
                continue

            try:
                stats = process_sentinel1_grd(
                    vv_url, vh_url, vv_calibration, vh_calibration,
                    vv_noise, vh_noise, geom_shape,
                    region=props.get("storage:region") or "eu-central-1"
                )
            except Exception as calibration_error:
                scene_errors.append(
                    f"{prod_id or 'escena sin ID'}: calibración sigma0 no disponible: {str(calibration_error)[:180]}"
                )
                continue

            polarizations = props.get("sar:polarizations") or ["VV", "VH"]
            instrument_mode = props.get("sar:instrument_mode")
            sensor = props.get("platform") or "Sentinel-1"
            return {
                "indicator": "Radar SAR Sentinel-1 GRD — retrodispersión calibrada sigma0",
                "product": "Sentinel-1 GRD Level-1C",
                "sensor": sensor,
                "polarizations": polarizations,
                "unit": "σ⁰ lineal / dB",
                "calibrationStatus": "SIGMA0_ELLIPSOID_CALIBRATED",
                "calibration": {
                    "coefficient": "sigma0-ellipsoid",
                    "method": "ESA per-polarisation calibration LUT",
                    "thermalNoiseRemovalApplied": stats.get("noiseRemovalApplied", False),
                    "thermalNoiseWarnings": stats.get("noiseWarnings", []),
                    "terrainCorrectionApplied": False,
                    "rtcApplied": False
                },
                "date": actual_date,
                "acquiredAt": props.get("datetime"),
                "publishedAt": props.get("created"),
                "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "productId": prod_id,
                "orbitState": orbit_state,
                "instrumentMode": instrument_mode,
                "sarResolutionRange": props.get("sar:resolution_range"),
                "crs": "EPSG:4326",
                "geometry": feat.get("geometry"),
                "coverage": feat.get("bbox"),
                "quality": {
                    "polarizations": polarizations,
                    "instrumentMode": instrument_mode,
                    "orbitState": orbit_state
                },
                "license": None,
                "areaHectares": area_ha,
                "isPoint": is_point,
                "allWeather": True,
                "cloudIndependent": True,
                "source": "Copernicus Sentinel-1 GRD / AWS Earth Search STAC",
                "sourceUrl": "https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd",
                "stats": stats,
                "interpretation": {
                    "status": "NOT_INFERRED",
                    "message": "No se infieren humedad del suelo, biomasa, especie, sanidad ni estructura forestal a partir de DN sin calibración radiométrica validada."
                },
                "limitations": [
                    "Se aplica calibración radiométrica sigma0 elipsoidal con las LUT ESA específicas de VV y VH; los valores lineales se convierten a dB mediante 10·log10.",
                    "La corrección geométrica y radiométrica del terreno (RTC gamma0-terrain) no está aplicada; sigma0 elipsoidal no equivale a un producto RTC.",
                    "La corrección de ruido térmico se aplica cuando la anotación de ruido de la escena está disponible y puede interpretarse; el estado se informa por separado.",
                    "La retrodispersión depende de polarización, órbita, ángulo de incidencia, humedad, rugosidad y estructura superficial; no permite inferir por sí sola humedad del suelo, biomasa, especie ni sanidad.",
                    "Las estadísticas VV y VH se calculan por separado sobre píxeles válidos calibrados."
                ],
                "status": "REAL",
                "message": f"Se procesó la escena real {prod_id} ({actual_date or 'fecha no registrada'}) con calibración sigma0 elipsoidal basada en LUT ESA."
            }

        detail = " | ".join(scene_errors[:5])
        return {
            "indicator": "Radar SAR Sentinel-1",
            "date": e_date,
            "productId": None,
            "areaHectares": area_ha,
            "status": "UNAVAILABLE",
            "source": "AWS Earth Search STAC (Sentinel-1 GRD)",
            "message": "Se encontraron escenas, pero ninguna produjo píxeles VV/VH válidos para este lote. " + detail
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "indicator": "Radar SAR Sentinel-1",
            "date": req.endDate or get_default_dates()[2],
            "productId": None,
            "areaHectares": 0.0,
            "status": "UNAVAILABLE",
            "source": "AWS Earth Search STAC (Sentinel-1 GRD)",
            "message": f"No se pudo consultar/procesar Sentinel-1: {str(e)}"
        }

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
    """
    Calcula la superficie exacta en metros cuadrados (m²) sobre el elipsoide WGS84 usando pyproj.Geod.

    Método: Geodesia directa sobre WGS84 (Geod.geometry_area_perimeter).
    Ventajas: Sin distorsión por proyección plana UTM en límites de faja ni aproximaciones planas simples.
    Limitaciones: Válido para polígonos GeoJSON WGS84 (EPSG:4326).
    """
    if geom_shape.geom_type == 'Point':
        return 0.0

    try:
        import pyproj
        geod = pyproj.Geod(ellps='WGS84')
        area_m2, _ = geod.geometry_area_perimeter(geom_shape)
        return abs(area_m2)
    except Exception:
        # Fallback a proyección local UTM si geod.geometry_area_perimeter falla por estructura compleja
        centroid = geom_shape.centroid
        lat_rad = math.radians(centroid.y)
        meters_per_deg_lat = 111132.92 - 559.82 * math.cos(2 * lat_rad)
        meters_per_deg_lng = 111412.84 * math.cos(lat_rad)
        return abs(geom_shape.area) * meters_per_deg_lat * meters_per_deg_lng


# Public FAO GAEZ v5 and Global Forest Watch lot-level analysis endpoints.
from backend.territorial_analysis import router as territorial_analysis_router
from backend.open_forest_data import router as open_forest_data_router
from backend.source_catalog import router as source_catalog_router
app.include_router(processing_engine_router)
app.include_router(source_catalog_router)
app.include_router(territorial_analysis_router)
app.include_router(open_forest_data_router)
