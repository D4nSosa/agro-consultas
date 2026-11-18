"""Public GAEZ v5 raster and Global Forest Watch zonal analysis endpoints.

GAEZ files are read directly from FAO's public Google Cloud Storage bucket.
GFW requests are proxied server-side; the API key is never exposed to browsers.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from shapely.geometry import shape, mapping
from shapely.ops import transform as transform_geometry

router = APIRouter(prefix="/api/territorial", tags=["Territorial datasets"])

GAEZ_README_URL = (
    "https://data.apps.fao.org/catalog/dataset/"
    "514c92d5-9e01-4c70-814a-80ea1ca9fe6a/resource/"
    "768b08ad-be9c-427a-84be-3a3d6dd7835a/download/_readme_res05.xlsx"
)
GAEZ_BASE_URL = "https://storage.googleapis.com/fao-gismgr-gaez-v5-data/DATA/GAEZ-V5/MAPSET"
GAEZ_CACHE: dict[str, Any] = {"expires": 0.0, "catalog": None, "codes": {}}
GAEZ_LOCK = threading.Lock()
GFW_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
GFW_LOCK = threading.Lock()


class LotDatasetRequest(BaseModel):
    geometry: dict[str, Any]
    mapset_code: Optional[str] = None
    crop: Optional[str] = None
    period: Optional[str] = None
    climate_data_source: Optional[str] = None
    ssp: Optional[str] = None
    input_level: Optional[str] = None


def _polygon(geometry: dict[str, Any]):
    try:
        geom = shape(geometry)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GeoJSON inválido: {exc}")
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise HTTPException(status_code=422, detail="El análisis requiere un polígono o multipolígono.")
    if geom.is_empty:
        raise HTTPException(status_code=400, detail="La geometría está vacía.")
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.is_empty or not geom.is_valid:
        raise HTTPException(status_code=400, detail="La geometría no es topológicamente válida.")
    minx, miny, maxx, maxy = geom.bounds
    if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
        raise HTTPException(status_code=400, detail="Las coordenadas deben estar en WGS84 (EPSG:4326).")
    if geom.area <= 0:
        raise HTTPException(status_code=400, detail="El polígono no tiene superficie.")
    return geom


def _read_excel_catalog():
    try:
        from openpyxl import load_workbook
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Falta openpyxl para leer el catálogo GAEZ: {exc}")
    request = urllib.request.Request(
        GAEZ_README_URL,
        headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    )
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            content = response.read(25_000_000)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo descargar el catálogo público FAO GAEZ v5: {exc}")
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        sheet = workbook["LIST_FILES"]
        expected = ["MAPSET_CODE", "PERIOD", "CLIMATE_DATA_SOURCE", "SSP", "CROP", "INPUT", "FILE_NAME"]
        header_row = None
        headers = []
        for row_index, row in enumerate(sheet.iter_rows(min_row=1, max_row=40, values_only=True), start=1):
            values = [str(value).strip().upper().replace(" ", "_") if value is not None else "" for value in row]
            if sum(name in values for name in expected) >= 6:
                header_row, headers = row_index, values
                break
        if header_row is None:
            raise ValueError("No se encontró la estructura LIST_FILES esperada.")
        positions = {name: headers.index(name) for name in expected if name in headers}
        missing = [name for name in expected if name not in positions]
        if missing:
            raise ValueError(f"Faltan columnas del catálogo: {', '.join(missing)}")
        records = []
        for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
            record = {name: (str(row[pos]).strip() if pos < len(row) and row[pos] is not None else "") for name, pos in positions.items()}
            if record["FILE_NAME"]:
                records.append(record)
        workbook.close()
        if not records:
            raise ValueError("El catálogo FAO no contiene archivos disponibles.")
        return records
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"El catálogo FAO GAEZ v5 no pudo interpretarse: {exc}")


def _gaez_catalog():
    now = time.monotonic()
    if GAEZ_CACHE["catalog"] is not None and now < GAEZ_CACHE["expires"]:
        return GAEZ_CACHE["catalog"]
    with GAEZ_LOCK:
        now = time.monotonic()
        if GAEZ_CACHE["catalog"] is not None and now < GAEZ_CACHE["expires"]:
            return GAEZ_CACHE["catalog"]
        records = _read_excel_catalog()
        GAEZ_CACHE.update({"catalog": records, "expires": now + 3600})
        return records


def _option_values(records, field):
    return sorted({row[field] for row in records if row.get(field)})


def _filtered_catalog(records, filters):
    result = records
    for field, value in filters.items():
        if value:
            result = [row for row in result if row.get(field) == value]
    return result


@router.get("/gaez/catalog")
def gaez_catalog(
    mapset_code: Optional[str] = None,
    crop: Optional[str] = None,
    period: Optional[str] = None,
    climate_data_source: Optional[str] = None,
    ssp: Optional[str] = None,
    input_level: Optional[str] = None,
):
    """Return live options from FAO's official RES05 workbook; no credentials required."""
    records = _filtered_catalog(_gaez_catalog(), {
        "MAPSET_CODE": mapset_code, "CROP": crop, "PERIOD": period,
        "CLIMATE_DATA_SOURCE": climate_data_source, "SSP": ssp, "INPUT": input_level,
    })
    return {
        "success": True,
        "source": "FAO/IIASA GAEZ v5 RES05 public catalog",
        "license": "CC-BY-4.0 (verify the specific dataset metadata before redistribution)",
        "readme": GAEZ_README_URL,
        "options": {
            "mapset_codes": _option_values(records, "MAPSET_CODE"),
            "crops": _option_values(records, "CROP"),
            "periods": _option_values(records, "PERIOD"),
            "climate_data_sources": _option_values(records, "CLIMATE_DATA_SOURCE"),
            "ssps": _option_values(records, "SSP"),
            "input_levels": _option_values(records, "INPUT"),
        },
        "matching_combinations": len(records),
        "spatial_scope": "Global, including Argentina",
    }


@router.post("/gaez/analyze")
def gaez_analyze(req: LotDatasetRequest):
    """Calculate transparent zonal statistics from a selected FAO GAEZ v5 RES05 GeoTIFF."""
    geom = _polygon(req.geometry)
    required = {
        "MAPSET_CODE": req.mapset_code, "CROP": req.crop, "PERIOD": req.period,
        "CLIMATE_DATA_SOURCE": req.climate_data_source, "SSP": req.ssp, "INPUT": req.input_level,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise HTTPException(status_code=422, detail=f"Seleccioná todos los parámetros GAEZ: {', '.join(missing)}")
    matches = _filtered_catalog(_gaez_catalog(), required)
    if not matches:
        raise HTTPException(status_code=404, detail="FAO no publica un archivo para esa combinación de variable, cultivo y escenario.")
    if len(matches) > 1:
        raise HTTPException(status_code=409, detail=f"La selección coincide con {len(matches)} archivos. Ajustá período, clima, SSP o nivel de insumo.")
    record = matches[0]
    filename = record["FILE_NAME"]
    if not filename.lower().endswith(".tif"):
        filename += ".tif"
    url = f"{GAEZ_BASE_URL}/{urllib.parse.quote(record['MAPSET_CODE'])}/{urllib.parse.quote(filename)}"
    try:
        import numpy as np
        import rasterio
        from rasterio.mask import mask as raster_mask
        from rasterio.warp import transform_geom

        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
            with rasterio.open("/vsicurl/" + url) as dataset:
                if dataset.crs is None:
                    raise ValueError("El ráster no declara sistema de coordenadas.")
                projected = transform_geom("EPSG:4326", dataset.crs, mapping(geom), precision=8)
                data, _ = raster_mask(dataset, [projected], crop=True, filled=False, all_touched=False)
                band = data[0]
                values = band.compressed()
                if dataset.nodata is not None:
                    values = values[values != dataset.nodata]
                values = values[np.isfinite(values)]
                if not values.size:
                    raise ValueError("No hay píxeles válidos del producto dentro del lote.")
                stats = {
                    "pixel_count": int(values.size),
                    "minimum": float(np.min(values)),
                    "maximum": float(np.max(values)),
                    "mean": float(np.mean(values)),
                    "median": float(np.median(values)),
                    "standard_deviation": float(np.std(values)),
                    "p25": float(np.percentile(values, 25)),
                    "p75": float(np.percentile(values, 75)),
                }
                resolution = [abs(float(value)) for value in dataset.res]
                crs = dataset.crs.to_string()
                nodata = dataset.nodata
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo procesar el GeoTIFF FAO para este lote: {exc}")
    return {
        "success": True,
        "source": "FAO/IIASA GAEZ v5 RES05",
        "source_url": url,
        "dataset": record,
        "statistics": stats,
        "raster": {"crs": crs, "resolution_native_units": resolution, "nodata": nodata},
        "method": "Estadística zonal de los píxeles válidos que intersectan el polígono (sin interpolación).",
        "interpretation_limit": "Se devuelven valores originales del ráster. La unidad, escala y significado dependen del producto seleccionado y deben leerse en sus metadatos; no son una medición de suelo ni una predicción del rendimiento real del lote.",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


@router.post("/gfw/analyze")
def gfw_analyze(req: LotDatasetRequest):
    """Proxy GFW's documented zonal analysis endpoint without exposing the API key."""
    geom = _polygon(req.geometry)
    api_key = os.environ.get("GFW_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "GFW_API_KEY_REQUIRED",
                "message": "El análisis GFW está integrado, pero falta configurar GFW_API_KEY en los secretos del backend.",
                "setup": "Solicitar una clave en Global Forest Watch y guardarla como variable de entorno del proyecto Vercel. Nunca incluirla en el frontend.",
            },
        )
    origin = os.environ.get("GFW_API_ORIGIN", "https://agro-consultas.vercel.app")
    payload = {
        "geometry": mapping(geom),
        "sum": ["area__ha"],
        "group_by": ["umd_tree_cover_loss__year"],
        "start_date": "2001",
        "end_date": str(dt.datetime.now(dt.timezone.utc).year - 1),
    }
    cache_key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    now = time.monotonic()
    with GFW_LOCK:
        cached = GFW_CACHE.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
    request = urllib.request.Request(
        "https://data-api.globalforestwatch.org/analysis/zonal",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": api_key,
            "Origin": origin,
            "User-Agent": "Agro-Consultas/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            result = json.loads(response.read(8_000_000).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Global Forest Watch no pudo completar el análisis zonal: {exc}")
    answer = {
        "success": True,
        "source": "Global Forest Watch Data API",
        "source_endpoint": "POST /analysis/zonal",
        "source_endpoint_status": "documented_deprecated_endpoint",
        "dataset_indicator": "umd_tree_cover_loss__year",
        "period": f"2001–{dt.datetime.now(dt.timezone.utc).year - 1}",
        "result": result,
        "interpretation_limit": "Pérdida de cobertura arbórea detectada por el producto UMD; no equivale automáticamente a deforestación ilegal ni a pérdida de bosque nativo. No sustituye el dataset argentino OTBN de GFW 2007–2022 mostrado como capa cartográfica.",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    with GFW_LOCK:
        GFW_CACHE[cache_key] = (now + 21600, answer)
    return answer
