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
import json
import io
import numpy as np
import tifffile
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

class SARAnalysisRequest(BaseModel):
    geometry: GeoJSONGeometry
    startDate: Optional[str] = None
    endDate: Optional[str] = None

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

@app.post("/api/forest/stac")
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


def search_stac_catalog(req: STACSearchRequest):
    """Consulta escenas Sentinel-2 L2A usando la geometría exacta y conserva calibración radiométrica STAC."""
    try:
        start_def, date_a_def, date_b_def = get_default_dates()
        s_date = req.startDate or start_def
        e_date = req.endDate or date_b_def

        geom_dict = get_geom_dict(req.geometry)
        validate_geometry_shape(geom_dict)

        search_body = {
            "collections": ["sentinel-2-l2a"],
            "intersects": geom_dict,
            "datetime": f"{s_date}T00:00:00Z/{e_date}T23:59:59Z",
            "limit": 20,
            "query": {
                "eo:cloud_cover": {"lte": req.maxCloudCover}
            }
        }

        req_data = json.dumps(search_body).encode('utf-8')
        aws_req = urllib.request.Request(
            EARTH_SEARCH_STAC_URL,
            data=req_data,
            headers={'Content-Type': 'application/json', 'Accept': 'application/geo+json, application/json'}
        )
        with urllib.request.urlopen(aws_req, timeout=15) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Earth Search respondió HTTP {resp.status}")
            data = json.loads(resp.read().decode('utf-8'))

        features = data.get("features", [])
        parsed_products = []
        calibration_rejected = 0

        for feat in features:
            props = feat.get("properties", {})
            item_assets = feat.get("assets", {})
            red_asset = item_assets.get("red") or item_assets.get("B04")
            nir_asset = item_assets.get("nir") or item_assets.get("B08")
            scl_asset = item_assets.get("scl")

            if not red_asset or not nir_asset or not scl_asset:
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
                "collection": "sentinel-2-l2a",
                "sensor": props.get("platform"),
                "product": "Sentinel-2 L2A Surface Reflectance",
                "source": "Copernicus Sentinel-2 / AWS Earth Search STAC",
                "sourceUrl": "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a",
                "resolution": red_resolution,
                "bands": ["B04 (Red)", "B08 (NIR)"],
                "geometry": feat.get("geometry"),
                "quality": {"eo:cloud_cover": cloud_cover_val},
                "license": None,
                "assets": {
                    "red": red_asset.get("href"),
                    "nir": nir_asset.get("href"),
                    "scl": scl_asset.get("href"),
                    "redScale": red_scale,
                    "redOffset": red_offset,
                    "nirScale": nir_scale,
                    "nirOffset": nir_offset,
                    "redResolution": red_resolution,
                    "nirResolution": nir_resolution,
                    "visual": item_assets.get("visual", {}).get("href"),
                    "thumbnail": item_assets.get("thumbnail", {}).get("href")
                }
            })

        parsed_products.sort(key=lambda item: item["cloudCover"] if item["cloudCover"] is not None else 999.0)
        if parsed_products:
            return {
                "success": True,
                "source": "Copernicus Sentinel-2 L2A / AWS Earth Search STAC",
                "productsCount": len(parsed_products),
                "bestProduct": parsed_products[0],
                "products": parsed_products,
                "calibrationRejectedCount": calibration_rejected
            }

        return {
            "success": False,
            "source": "AWS Earth Search STAC",
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "calibrationRejectedCount": calibration_rejected,
            "message": "No se encontraron escenas Sentinel-2 con bandas RED/NIR, SCL y calibración radiométrica completa para la geometría y período solicitados."
        }
    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "source": "AWS Earth Search STAC",
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "message": f"No se pudo consultar Earth Search STAC: {str(e)}"
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


def process_cog_raster_ndvi_cropped(
    red_url, nir_url, scl_url, geom_shape,
    red_scale=1.0, red_offset=0.0, nir_scale=1.0, nir_offset=0.0
):
    """
    Recorta RED/NIR, aplica escala y offset STAC antes de NDVI y exige máscara SCL.
    Reproyecta SCL con nearest-neighbour y bandas espectrales con bilinear.
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

        if not scl_url:
            return None, "La escena no publica SCL; no se calcula NDVI sin máscara de calidad."

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
                    "sclFilterApplied": True,
                    "qualityMaskType": "Sentinel-2 SCL",
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

            nir_nodata = src_nir.nodata if src_nir.nodata is not None else 0
            valid_red = (red_data != red_nodata) & (red_data > 0)
            valid_nir = (nir_aligned != nir_nodata) & (nir_aligned > 0)
            red_reflectance = red_data.astype(np.float64) * red_scale + red_offset
            nir_reflectance = nir_aligned.astype(np.float64) * nir_scale + nir_offset
            denominator = nir_reflectance + red_reflectance

            scl_excluded = np.isin(scl_aligned, [0, 1, 3, 8, 9, 10, 11])
            valid = (
                valid_red & valid_nir & (~scl_excluded) &
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
                "sclFilterApplied": True,
                "sclWarning": None,
                "qualityMaskType": "Sentinel-2 SCL",
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
                stats, err_msg = process_cog_raster_ndvi_cropped(
                    red_url, nir_url, scl_url, geom_shape,
                    red_scale=assets.get("redScale", 1.0),
                    red_offset=assets.get("redOffset", 0.0),
                    nir_scale=assets.get("nirScale", 1.0),
                    nir_offset=assets.get("nirOffset", 0.0)
                )
                prod_id = best.get("id")
                cloud_pct = best.get("cloudCover", 0.0)
                actual_date = best.get("date", target_date)

                if stats:
                    mean_val = stats["mean"]
                    v_class = "Excelente vigor vegetativo" if mean_val >= 0.65 else ("Vigor vegetativo moderado" if mean_val >= 0.45 else "Cobertura/vigor bajo")

                    scl_warn = stats.get("sclWarning")
                    base_msg = "NDVI calculado sobre reflectancia superficial calibrada (escala y offset STAC) y máscara SCL por píxel."
                    base_detail = f"Procesado desde COGs Sentinel-2 L2A; reflectancia escalada con metadatos STAC y píxeles SCL de nubes/sombras excluidos (Escena: {prod_id}, Fecha: {actual_date})."

                    if scl_warn:
                        base_msg += f" (LIMITACIÓN: {scl_warn})"
                        base_detail += f" LIMITACIÓN SCL: {scl_warn}"

                    return {
                        "indicator": "NDVI (Normalized Difference Vegetation Index)",
                        "formula": "NDVI = (B08_NIR - B04_RED) / (B08_NIR + B04_RED)",
                        "bands": {"NIR": "B08 (842 nm)", "RED": "B04 (665 nm)"},
                        "spatialResolution": f"{best.get('resolution') or 10} metros",
                        "date": actual_date,
                        "productId": prod_id,
                        "areaHectares": area_ha,
                        "isPoint": is_point,
                        "source": best.get("source", "Copernicus Sentinel-2 / AWS Earth Search STAC"),
                        "sensor": best.get("sensor"),
                        "product": best.get("product"),
                        "spatialResolution": best.get("resolution"),
                        "acquiredAt": best.get("acquiredAt"),
                        "publishedAt": best.get("publishedAt"),
                        "quality": best.get("quality"),
                        "license": best.get("license"),
                        "cloudCover": f"{cloud_pct}%",
                        "stats": stats,
                        "decisionVigor": {
                            "clasificacionSimple": v_class,
                            "icono": "🟢" if mean_val >= 0.5 else "🟡",
                            "detalleTecnico": base_detail
                        },
                        "status": "REAL",
                        "message": base_msg
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
                    (crsA is None or crsB is None or crsA == crsB) and
                    (trA is None or trB is None or trA == trB)
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
                    desc = f"Se observa reducción del vigor vegetativo en {dec_ha} ha ({dec_pct}% del lote). Puede deberse a raleo, cosecha o eventos climáticos. Se sugiere verificación de campo."
                elif inc_pct > 30.0 or delta_ndvi >= 0.15:
                    classification = "AUMENTO_SIGNIFICATIVO"
                    msg = f"Aumento significativo del índice de vegetación detectado (ΔNDVI: +{delta_ndvi})."
                    desc = f"Se observa incremento del vigor vegetativo en {inc_ha} ha ({inc_pct}% del lote)."
                else:
                    classification = "ESTABLE"
                    msg = f"Cobertura vegetativa estable entre ambas observaciones (ΔNDVI: {delta_ndvi})."
                    desc = f"El {st_pct}% de la superficie del lote ({st_ha} ha) se mantiene estable dentro de los márgenes normales de variación estacional."

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
                    desc = "Se observa una reducción del vigor vegetativo medio entre ambas fechas."
                elif delta_ndvi >= 0.15:
                    classification = "AUMENTO_SIGNIFICATIVO"
                    msg = f"Aumento del índice de vegetación medio (ΔNDVI: +{delta_ndvi})."
                    desc = "Se observa un incremento en la cobertura/biomasa vegetativa media entre ambas fechas."
                else:
                    classification = "ESTABLE"
                    msg = f"Respuesta espectral media estable entre ambas observaciones (ΔNDVI: {delta_ndvi})."
                    desc = "La variación del índice medio de vegetación se mantiene estable."

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

def process_cog_raster_sar_cropped(vv_url, vh_url, geom_shape):
    """Procesa y recorta exactamente los píxeles radar SAR Sentinel-1 COG para el ROI del lote."""
    try:
        # Importar Rasterio dentro del procesador evita que su fallo nativo tumbe toda la API.
        import rasterio
        from rasterio.mask import mask as rasterio_mask
        from rasterio.vrt import WarpedVRT

        with rasterio.env.Env(AWS_NO_SIGN_REQUEST='YES'):
            with rasterio.open(vv_url) as src_vv, rasterio.open(vh_url) as src_vh:
                with WarpedVRT(src_vv, crs='EPSG:4326') as vrt_vv, WarpedVRT(src_vh, crs='EPSG:4326') as vrt_vh:
                    if geom_shape.geom_type == 'Point':
                        pt_x, pt_y = geom_shape.x, geom_shape.y
                        row_v, col_v = vrt_vv.index(pt_x, pt_y)
                        val_vv = float(vrt_vv.read(1, window=rasterio.windows.Window(col_v, row_v, 1, 1))[0, 0])
                        val_vh = float(vrt_vh.read(1, window=rasterio.windows.Window(col_v, row_v, 1, 1))[0, 0])
                        vv_db = round(10 * math.log10(val_vv**2 + 1e-6) - 83.0, 2) if val_vv > 0 else -25.0
                        vh_db = round(10 * math.log10(val_vh**2 + 1e-6) - 83.0, 2) if val_vh > 0 else -30.0
                        ratio_db = round(vh_db - vv_db, 2)
                        return {
                            "vv_mean_dB": vv_db,
                            "vh_mean_dB": vh_db,
                            "vh_vv_ratio_dB": ratio_db,
                            "sampleCount": 1,
                            "isPoint": True
                        }, None
                    else:
                        out_vv, _ = rasterio_mask(vrt_vv, [geom_shape], crop=True)
                        out_vh, _ = rasterio_mask(vrt_vh, [geom_shape], crop=True)
                        vv_vals = out_vv[0][out_vv[0] > 0].astype(float)
                        vh_vals = out_vh[0][out_vh[0] > 0].astype(float)
                        if len(vv_vals) == 0 or len(vh_vals) == 0:
                            return None, "No se obtuvieron píxeles válidos de radar en el polígono seleccionado."

                        vv_db = round(float(np.mean(10 * np.log10(np.square(vv_vals) + 1e-6) - 83.0)), 2)
                        vh_db = round(float(np.mean(10 * np.log10(np.square(vh_vals) + 1e-6) - 83.0)), 2)
                        ratio_db = round(vh_db - vv_db, 2)
                        return {
                            "vv_mean_dB": vv_db,
                            "vh_mean_dB": vh_db,
                            "vh_vv_ratio_dB": ratio_db,
                            "sampleCount": int(len(vv_vals)),
                            "isPoint": False
                        }, None
    except Exception as e:
        return None, str(e)

def interpret_sar_indicators(vv_db, ratio_db):
    """Describe señales de retrodispersión sin presentarlas como mediciones directas de campo."""
    if vv_db > -8.0:
        moisture = "Retrodispersión VV alta. Puede relacionarse con humedad superficial, rugosidad, agua o estructura; requiere contexto local."
    elif vv_db > -14.0:
        moisture = "Retrodispersión VV intermedia. No permite determinar por sí sola la humedad del suelo."
    else:
        moisture = "Retrodispersión VV baja. Puede responder a superficie lisa/seca u otras condiciones; no confirma sequedad."

    if ratio_db > -8.0:
        structure = "Relación VH−VV relativamente alta, compatible con mayor dispersión volumétrica en algunos contextos; no cuantifica biomasa."
    elif ratio_db > -12.0:
        structure = "Relación VH−VV intermedia. La estructura de la cubierta no puede determinarse de forma concluyente con este valor aislado."
    else:
        structure = "Relación VH−VV baja. No confirma suelo desnudo ni ausencia de biomasa."

    return moisture, structure

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
            "limit": 10
        }

        req_data = json.dumps(search_body).encode('utf-8')
        aws_req = urllib.request.Request(
            EARTH_SEARCH_STAC_URL,
            data=req_data,
            headers={'Content-Type': 'application/json', 'Accept': 'application/geo+json, application/json'}
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
            actual_date = props.get("datetime", "").split("T")[0] if props.get("datetime") else None
            orbit_state = props.get("sat:orbit_state", "NO DISPONIBLE")
            vv_url = assets.get("vv", {}).get("href")
            vh_url = assets.get("vh", {}).get("href")

            if not vv_url or not vh_url:
                scene_errors.append(f"{prod_id or 'escena sin ID'}: faltan activos VV/VH")
                continue

            stats, err_msg = process_cog_raster_sar_cropped(vv_url, vh_url, geom_shape)
            if not stats:
                scene_errors.append(f"{prod_id or 'escena sin ID'}: {err_msg or 'sin píxeles válidos'}")
                continue

            moisture_desc, structure_desc = interpret_sar_indicators(
                stats["vv_mean_dB"], stats["vh_vv_ratio_dB"]
            )
            return {
                "indicator": "Radar SAR Sentinel-1 (Banda C / todo clima)",
                "polarizations": ["VV (Vertical-Vertical)", "VH (Vertical-Horizontal)"],
                "ratioMeaning": "Diferencia VH−VV en dB; indicador de respuesta de dispersión, no medición directa de biomasa.",
                "date": actual_date,
                "productId": prod_id,
                "orbitState": orbit_state,
                "areaHectares": area_ha,
                "isPoint": is_point,
                "allWeather": True,
                "cloudIndependent": True,
                "source": "AWS Earth Search STAC (Sentinel-1 GRD COGs)",
                "stats": stats,
                "interpretation": {
                    "sueloHumedad": moisture_desc,
                    "estructuraBiomasa": structure_desc
                },
                "status": "REAL",
                "message": f"Se procesó la escena real {prod_id} ({actual_date or 'fecha no registrada'})."
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
app.include_router(territorial_analysis_router)
app.include_router(open_forest_data_router)
