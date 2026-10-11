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
    """Consulta el catálogo público AWS Earth Search STAC para Sentinel-2 L2A"""
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

        # Consulta catálogo anónimo AWS Earth Search STAC
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

        return {
            "success": False,
            "source": "AWS Earth Search STAC",
            "productsCount": 0,
            "bestProduct": None,
            "products": [],
            "message": "NO DISPONIBLE / No se encontraron escenas reales o la API no respondió"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error procesando búsqueda STAC: {str(e)}")

import rasterio
from rasterio.mask import mask as rasterio_mask
from rasterio.warp import reproject, Resampling
import pyproj

def process_cog_raster_ndvi_cropped(red_url, nir_url, scl_url, geom_shape):
    """
    Procesa y recorta exactamente los píxeles COG que intersectan con la geometría ROI del lote.
    Garantiza estricta alineación geoespacial, reproyección si difieren CRS o grillas,
    y remuestreo apropiado (bilineal para bandas espectrales, nearest para SCL categórica).
    """
    try:
        with rasterio.open(red_url) as src_red, rasterio.open(nir_url) as src_nir:
            # 1. Transformar la geometría GeoJSON a la proyección de la banda RED
            transformer = pyproj.Transformer.from_crs('EPSG:4326', src_red.crs, always_xy=True)
            if geom_shape.geom_type == 'Polygon':
                poly_coords = [transformer.transform(x, y) for x, y in geom_shape.exterior.coords]
                geom_proj = Polygon(poly_coords)
            elif geom_shape.geom_type == 'Point':
                pt_x, pt_y = transformer.transform(geom_shape.x, geom_shape.y)
                geom_proj = Point(pt_x, pt_y)
            else:
                geom_proj = geom_shape

            if geom_shape.geom_type == 'Point':
                row_r, col_r = src_red.index(geom_proj.x, geom_proj.y)
                window_r = rasterio.windows.Window(col_r, row_r, 1, 1)
                val_red = src_red.read(1, window=window_r)[0, 0]

                # Reproyectar el punto al CRS propio de NIR cuando sea diferente
                if src_nir.crs == src_red.crs:
                    pt_x_n, pt_y_n = geom_proj.x, geom_proj.y
                else:
                    transformer_nir_pt = pyproj.Transformer.from_crs('EPSG:4326', src_nir.crs, always_xy=True)
                    pt_x_n, pt_y_n = transformer_nir_pt.transform(geom_shape.x, geom_shape.y)

                row_n, col_n = src_nir.index(pt_x_n, pt_y_n)
                window_n = rasterio.windows.Window(col_n, row_n, 1, 1)
                val_nir = src_nir.read(1, window=window_n)[0, 0]

                # Tratar nodata / valores de borde
                if src_red.nodata is not None and val_red == src_red.nodata:
                    return None, "Punto fuera de rango o píxel nodata."
                if src_nir.nodata is not None and val_nir == src_nir.nodata:
                    return None, "Punto fuera de rango o píxel nodata."

                denom = float(val_nir) + float(val_red)
                if denom <= 0 or val_red <= 0 or val_nir <= 0:
                    return None, "Punto fuera de rango o valor de reflectancia inválido/nulo."

                ndvi_pt = round((float(val_nir) - float(val_red)) / denom, 4)
                return {
                    "min": ndvi_pt,
                    "max": ndvi_pt,
                    "mean": ndvi_pt,
                    "median": ndvi_pt,
                    "stdDev": 0.0,
                    "validPixelsPercent": 100.0,
                    "sampleCount": 1,
                    "isPoint": True
                }, None

            # 2. Recortar banda RED al polígono ROI (malla de referencia principal)
            out_red, transform_red = rasterio_mask(src_red, [geom_proj], crop=True, nodata=src_red.nodata)
            red_data = out_red[0]

            # Construir máscara booleana de píxeles que pertenecen estrictamente al interior del polígono ROI
            # rasterio_mask asigna nodata a los píxeles fuera del polígono
            red_nodata = src_red.nodata if src_red.nodata is not None else 0
            roi_mask = (red_data != red_nodata)
            roi_pixel_count = int(np.sum(roi_mask))
            if roi_pixel_count == 0:
                # Si todos los píxeles dentro del recorte tienen valor nodata/fuera del ROI
                roi_pixel_count = red_data.size

            # Transformar geometría al CRS propio de NIR antes de recortar
            if src_nir.crs == src_red.crs:
                geom_proj_nir = geom_proj
            else:
                transformer_nir = pyproj.Transformer.from_crs('EPSG:4326', src_nir.crs, always_xy=True)
                if geom_shape.geom_type == 'Polygon':
                    poly_coords_nir = [transformer_nir.transform(x, y) for x, y in geom_shape.exterior.coords]
                    geom_proj_nir = Polygon(poly_coords_nir)
                else:
                    geom_proj_nir = geom_shape

            # 3. Recortar y reproyectar/alinear banda NIR a la grilla exacta de RED
            out_nir_raw, transform_nir = rasterio_mask(src_nir, [geom_proj_nir], crop=True, nodata=src_nir.nodata)
            nir_raw = out_nir_raw[0]

            # Verificar si las grillas espectrales RED y NIR están 100% alineadas
            if (src_red.crs == src_nir.crs and
                src_red.transform == src_nir.transform and
                nir_raw.shape == red_data.shape):
                nir_aligned = nir_raw
            else:
                # Reproyectar NIR a la grilla de referencia de RED usando remuestreo bilineal
                nir_aligned = np.full_like(red_data, src_nir.nodata if src_nir.nodata is not None else 0, dtype=nir_raw.dtype)
                reproject(
                    source=nir_raw,
                    destination=nir_aligned,
                    src_transform=transform_nir,
                    src_crs=src_nir.crs,
                    dst_transform=transform_red,
                    dst_crs=src_red.crs,
                    resampling=Resampling.bilinear,
                    src_nodata=src_nir.nodata,
                    dst_nodata=src_nir.nodata
                )

            # 4. Procesar y reproyectar/alinear SCL (Scene Classification Layer) si está disponible
            scl_aligned = None
            scl_error_reason = None
            scl_filter_applied = False

            if scl_url:
                try:
                    with rasterio.open(scl_url) as src_scl:
                        if src_scl.crs == src_red.crs:
                            geom_proj_scl = geom_proj
                        else:
                            transformer_scl = pyproj.Transformer.from_crs('EPSG:4326', src_scl.crs, always_xy=True)
                            if geom_shape.geom_type == 'Polygon':
                                poly_coords_scl = [transformer_scl.transform(x, y) for x, y in geom_shape.exterior.coords]
                                geom_proj_scl = Polygon(poly_coords_scl)
                            else:
                                geom_proj_scl = geom_shape

                        out_scl_raw, transform_scl = rasterio_mask(src_scl, [geom_proj_scl], crop=True, nodata=src_scl.nodata)
                        scl_raw = out_scl_raw[0]

                        if (src_scl.crs == src_red.crs and
                            src_scl.transform == src_red.transform and
                            scl_raw.shape == red_data.shape):
                            scl_aligned = scl_raw
                        else:
                            # Reproyectar SCL a la grilla RED usando remuestreo Nearest Neighbor (categórico)
                            scl_aligned = np.zeros_like(red_data, dtype=scl_raw.dtype)
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
                except Exception as scl_err:
                    scl_aligned = None
                    scl_filter_applied = False
                    scl_error_reason = f"No se pudo cargar o alinear la capa de clasificación SCL ({str(scl_err)})."

            # 5. Máscara de píxeles válidos (reflectancia real > 0 y nodata)
            nir_nodata = src_nir.nodata if src_nir.nodata is not None else 0

            valid_red = (red_data != red_nodata) & (red_data > 0)
            valid_nir = (nir_aligned != nir_nodata) & (nir_aligned > 0)
            denom = nir_aligned.astype(float) + red_data.astype(float)

            valid = valid_red & valid_nir & (denom > 0)

            # Aplicar filtro de nubes/sombras SCL categórico si está disponible
            if scl_aligned is not None:
                # Clases SCL a descartar: 3 (Sombra de nube), 8 (Nube probabilidad media), 9 (Nube probabilidad alta), 10 (Cirrus), 11 (Nieve/Hielo)
                cloud_mask = (scl_aligned == 3) | (scl_aligned == 8) | (scl_aligned == 9) | (scl_aligned == 10) | (scl_aligned == 11)
                valid = valid & (~cloud_mask)

            # 6. Cálculo NDVI
            ndvi_array = np.where(valid, (nir_aligned.astype(float) - red_data.astype(float)) / np.where(valid, denom, 1.0), np.nan)
            valid_ndvi = ndvi_array[~np.isnan(ndvi_array)]

            if len(valid_ndvi) == 0:
                return None, "No se obtuvieron píxeles válidos/libres de nubes dentro del polígono ROI del lote."

            min_val = round(float(np.min(valid_ndvi)), 4)
            max_val = round(float(np.max(valid_ndvi)), 4)
            mean_val = round(float(np.mean(valid_ndvi)), 4)
            median_val = round(float(np.median(valid_ndvi)), 4)
            std_val = round(float(np.std(valid_ndvi)), 4)
            # Calcular porcentaje de píxeles válidos respecto a los píxeles reales que pertenecen al polígono ROI
            valid_pct = round((float(len(valid_ndvi)) / float(roi_pixel_count)) * 100.0, 1)

            # Reemplazar NaN por None para cumplir estricta conformidad JSON
            clean_matrix = np.where(np.isnan(ndvi_array), None, ndvi_array).tolist()

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
                "sclWarning": scl_error_reason if (scl_url and not scl_filter_applied) else None,
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
                stats, err_msg = process_cog_raster_ndvi_cropped(red_url, nir_url, scl_url, geom_shape)
                prod_id = best.get("id")
                cloud_pct = best.get("cloudCover", 0.0)
                actual_date = best.get("date", target_date)

                if stats:
                    mean_val = stats["mean"]
                    v_class = "Excelente vigor vegetativo" if mean_val >= 0.65 else ("Vigor vegetativo moderado" if mean_val >= 0.45 else "Cobertura/vigor bajo")

                    scl_warn = stats.get("sclWarning")
                    base_msg = "NDVI por píxel calculated con éxito a partir de bandas COG reales de Sentinel-2."
                    base_detail = f"Procesado anónimamente desde píxeles COG reales de B04/B08 (Escena: {prod_id}, Fecha: {actual_date})."

                    if scl_warn:
                        base_msg += f" (LIMITACIÓN: {scl_warn})"
                        base_detail += f" LIMITACIÓN SCL: {scl_warn}"

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

            if rawA and rawB:
                matA = np.array(rawA, dtype=float)
                matB = np.array(rawB, dtype=float)

                if matA.shape == matB.shape:
                    # Comparación espacial píxel por píxel exacta
                    diff_matrix = matB - matA
                    valid_diffs = diff_matrix[~np.isnan(diff_matrix)]

                if len(valid_diffs) > 0:
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
                    "classification": classification,
                    "primaryMessage": msg,
                    "description": desc,
                    "breakdown": {
                        "decrease": {"hectares": "Matriz espacial no alineada", "percent": "N/D"},
                        "stable": {"hectares": "Matriz espacial no alineada", "percent": "N/D"},
                        "increase": {"hectares": "Matriz espacial no alineada", "percent": "N/D"}
                    },
                    "products": {
                        "productA": ndvi_resA.get("productId"),
                        "productB": ndvi_resB.get("productId")
                    },
                    "disclaimer": "Las variaciones espectrales representan la diferencia entre las medias de NDVI del ROI."
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
