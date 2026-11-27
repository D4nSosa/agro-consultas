"""On-demand geospatial acquisition and analysis orchestrator.

Centralizes AOI validation, allow-listed STAC discovery, bounded pagination,
scene metadata normalization, exact-scene dispatch and delegation to existing
specialized raster/territorial processors. It does not duplicate their algorithms.
A catalog asset is never treated as processed until a specialist reads valid pixels.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import threading
import concurrent.futures
import urllib.parse
import time
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from shapely.geometry import shape, mapping
from shapely.validation import explain_validity

router = APIRouter(prefix="/api/engine", tags=["Geospatial processing engine"])

PROVIDERS = {
    "sentinel-1-grd": {
        "provider": "AWS Earth Search",
        "endpoint": "https://earth-search.aws.element84.com/v1/search",
        "collection": "sentinel-1-grd",
        "product": "Sentinel-1 GRD",
        "kind": "radar",
        "catalog": "https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd",
    },
    "sentinel-2-l2a": {
        "provider": "AWS Earth Search",
        "endpoint": "https://earth-search.aws.element84.com/v1/search",
        "collection": "sentinel-2-l2a",
        "product": "Sentinel-2 Level-2A",
        "kind": "optical",
        "catalog": "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a",
    },
    "landsat-c2-l2": {
        "provider": "Microsoft Planetary Computer",
        "endpoint": "https://planetarycomputer.microsoft.com/api/stac/v1/search",
        "collection": "landsat-c2-l2",
        "product": "Landsat Collection 2 Level-2",
        "kind": "optical",
        "catalog": "https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2",
    },
}
CACHE_TTL_SECONDS = 600
CACHE_MAX_ENTRIES = 128
_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_LOCK = threading.Lock()


class SceneSearchRequest(BaseModel):
    geometry: dict[str, Any] = Field(description="GeoJSON Point, Polygon, MultiPolygon o Feature en WGS84/EPSG:4326")
    startDate: dt.date
    endDate: dt.date
    collections: list[str] = Field(default_factory=lambda: list(PROVIDERS))
    limit: int = Field(default=50, ge=1, le=100)


class ProcessSceneRequest(BaseModel):
    geometry: dict[str, Any] = Field(description="GeoJSON Point, Polygon, MultiPolygon o Feature en WGS84/EPSG:4326")
    collection: str
    productId: str = Field(min_length=1, max_length=256)
    date: dt.date


class DatasetAnalysisRequest(BaseModel):
    geometry: dict[str, Any] = Field(description="GeoJSON Polygon o MultiPolygon en WGS84/EPSG:4326")
    processor: str
    mapset_code: str | None = None
    crop: str | None = None
    period: str | None = None
    climate_data_source: str | None = None
    ssp: str | None = None
    input_level: str | None = None


def _validated_geometry(value: dict[str, Any]):
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="El AOI debe ser una geometría GeoJSON.")
    if value.get("type") == "Feature":
        value = value.get("geometry")
    if not isinstance(value, dict) or value.get("type") not in ("Point", "Polygon", "MultiPolygon"):
        raise HTTPException(status_code=422, detail="El AOI debe ser Point, Polygon o MultiPolygon GeoJSON.")
    try:
        geom = shape(value)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"GeoJSON inválido: {str(exc)[:120]}")
    if geom.is_empty or not geom.is_valid:
        reason = explain_validity(geom) if not geom.is_empty else "geometría vacía"
        raise HTTPException(status_code=422, detail=f"Geometría inválida: {reason}")
    west, south, east, north = geom.bounds
    if not all(-180 <= x <= 180 for x in (west, east)) or not all(-90 <= y <= 90 for y in (south, north)):
        raise HTTPException(status_code=422, detail="Las coordenadas deben estar en WGS84 (longitud/latitud).")
    return geom


def _cache_key(geometry: dict, start: dt.date, end: dt.date, collections: list[str], limit: int) -> str:
    canonical = json.dumps(geometry, sort_keys=True, separators=(",", ":"))
    payload = "|".join((canonical, start.isoformat(), end.isoformat(), ",".join(collections), str(limit)))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_get(key: str):
    now = time.monotonic()
    with _CACHE_LOCK:
        item = _CACHE.get(key)
        if item and now < item["expires"]:
            return item["payload"]
        if item:
            _CACHE.pop(key, None)
    return None


def _cache_put(key: str, payload: dict):
    now = time.monotonic()
    with _CACHE_LOCK:
        expired = [key for key, value in _CACHE.items() if now >= value["expires"]]
        for old_key in expired:
            _CACHE.pop(old_key, None)
        while len(_CACHE) >= CACHE_MAX_ENTRIES:
            oldest = min(_CACHE, key=lambda item: _CACHE[item]["created"])
            _CACHE.pop(oldest, None)
        _CACHE[key] = {"payload": payload, "created": now, "expires": now + CACHE_TTL_SECONDS}


def _read_stac_page(provider: dict, body: dict) -> dict:
    request = urllib.request.Request(
        provider["endpoint"],
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/geo+json, application/json",
            "User-Agent": "Agro-Consultas/1.0 (+https://agro-consultas.vercel.app)",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("El catálogo devolvió más de 8 MB en una página.")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("El catálogo no devolvió un STAC FeatureCollection válido.")
    if not isinstance(payload.get("features"), list) or not isinstance(payload.get("links", []), list):
        raise ValueError("El STAC FeatureCollection contiene features o links inválidos.")
    return payload


def _read_stac_next_page(provider: dict, link: dict) -> dict:
    href = link.get("href")
    if not isinstance(href, str):
        raise ValueError("El enlace de paginación STAC no contiene href.")
    target = urllib.parse.urljoin(provider["endpoint"], href)
    parsed_target = urllib.parse.urlparse(target)
    parsed_origin = urllib.parse.urlparse(provider["endpoint"])
    if parsed_target.scheme != "https" or parsed_target.netloc != parsed_origin.netloc:
        raise ValueError("Se rechazó un enlace de paginación fuera del origen STAC autorizado.")
    method = str(link.get("method") or "GET").upper()
    if method not in ("GET", "POST"):
        raise ValueError(f"Método de paginación STAC no admitido: {method}")
    body = link.get("body") if method == "POST" else None
    data = json.dumps(body).encode("utf-8") if isinstance(body, dict) else None
    headers = {
        "Accept": "application/geo+json, application/json",
        "User-Agent": "Agro-Consultas/1.0 (+https://agro-consultas.vercel.app)",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(target, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("El catálogo devolvió más de 8 MB en una página.")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("La página siguiente no devolvió un STAC FeatureCollection válido.")
    if not isinstance(payload.get("features"), list) or not isinstance(payload.get("links", []), list):
        raise ValueError("La página siguiente contiene features o links inválidos.")
    return payload


def _read_stac_pages(
    provider: dict,
    body: dict,
    max_pages: int = 5,
    max_items: int = 100,
) -> tuple[list[dict], bool, int]:
    """Read bounded STAC pages without exceeding the caller's total item budget."""
    if max_pages < 1 or max_items < 1:
        raise ValueError("Los límites de paginación deben ser positivos.")
    payload = _read_stac_page(provider, body)
    first_page_features = [item for item in payload["features"] if isinstance(item, dict)]
    features = first_page_features[:max_items]
    truncated = len(first_page_features) > max_items
    pages = 1
    next_link = next(
        (link for link in (payload.get("links") or []) if isinstance(link, dict) and link.get("rel") == "next"),
        None,
    )
    while next_link and pages < max_pages and len(features) < max_items:
        payload = _read_stac_next_page(provider, next_link)
        page_features = [item for item in payload["features"] if isinstance(item, dict)]
        remaining_budget = max_items - len(features)
        truncated = truncated or len(page_features) > remaining_budget
        features.extend(page_features[:remaining_budget])
        pages += 1
        next_link = next(
            (link for link in (payload.get("links") or []) if isinstance(link, dict) and link.get("rel") == "next"),
            None,
        )
    # hasMore means more items exist beyond the returned budget/page budget.
    return features, bool(next_link) or truncated, pages


def _asset_summary(assets: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for key, asset in assets.items():
        if not isinstance(asset, dict):
            continue
        href = asset.get("href")
        if isinstance(href, str):
            if href.startswith("https://"):
                pass
            elif href.startswith("s3://") and href.split("/", 3)[2] == "sentinel-s1-l1c":
                # Earth Search publishes Sentinel-1 measurement/annotation assets in this public bucket.
                pass
            else:
                href = None
        else:
            href = None
        result[str(key)] = {
            "href": href,
            "title": asset.get("title"),
            "type": asset.get("type"),
            "roles": asset.get("roles") if isinstance(asset.get("roles"), list) else [],
            "eoBands": asset.get("eo:bands") if isinstance(asset.get("eo:bands"), list) else [],
            "rasterBands": asset.get("raster:bands") if isinstance(asset.get("raster:bands"), list) else [],
            "fileSize": asset.get("file:size"),
            "checksum": asset.get("file:checksum"),
            "gsd": asset.get("gsd"),
            "projection": {
                "epsg": asset.get("proj:epsg"),
                "shape": asset.get("proj:shape"),
                "transform": asset.get("proj:transform"),
            },
        }
    return result


def _normalize_scene(item: dict, provider: dict) -> dict:
    props = item.get("properties") if isinstance(item.get("properties"), dict) else {}
    assets = _asset_summary(item.get("assets") if isinstance(item.get("assets"), dict) else {})
    polarizations = props.get("sar:polarizations") or props.get("sar:polarisation")
    if not isinstance(polarizations, list):
        polarizations = []
    eo_bands = []
    for asset in assets.values():
        for band in asset["eoBands"]:
            if isinstance(band, dict):
                name = band.get("name") or band.get("common_name")
                if name and name not in eo_bands:
                    eo_bands.append(name)
    return {
        "id": item.get("id"),
        "collection": item.get("collection") or provider["collection"],
        "product": provider["product"],
        "provider": provider["provider"],
        "kind": provider["kind"],
        "datetime": props.get("datetime") or props.get("start_datetime"),
        "platform": props.get("platform"),
        "constellation": props.get("constellation"),
        "instruments": props.get("instruments"),
        "processingLevel": props.get("processing:level"),
        "storageRegion": props.get("storage:region"),
        "mode": props.get("sar:instrument_mode"),
        "polarizations": polarizations,
        "bands": eo_bands,
        "orbitState": props.get("sat:orbit_state"),
        "relativeOrbit": props.get("sat:relative_orbit"),
        "absoluteOrbit": props.get("sat:absolute_orbit"),
        "cloudCoverPercent": props.get("eo:cloud_cover"),
        "geometry": item.get("geometry"),
        "bbox": item.get("bbox"),
        "assets": assets,
        "assetKeys": list(assets),
        "assetCount": len(assets),
        "catalogItemUrl": next(
            (link.get("href") for link in item.get("links", [])
             if isinstance(link, dict) and link.get("rel") == "self" and isinstance(link.get("href"), str)
             and link["href"].startswith("https://")),
            None,
        ),
        "collectionUrl": provider["catalog"],
        "coverageStatus": "INTERSECTS_AOI",
        "limitations": [
            "La intersección de la huella con el AOI no implica cobertura completa del lote.",
            "La presencia de un asset en STAC no confirma que el archivo sea descargable o procesable.",
            "Las bandas y polarizaciones se informan únicamente cuando están publicadas en los metadatos.",
        ],
    }



@router.post("/process")
def process_discovered_scene(request: ProcessSceneRequest):
    """Process one exact catalog scene using the existing specialized Forestal processors."""
    if request.collection not in PROVIDERS:
        raise HTTPException(status_code=422, detail="Colección no admitida por el motor.")
    geom = _validated_geometry(request.geometry)
    geometry = mapping(geom)
    geojson_geometry = {
        "type": geometry["type"],
        "coordinates": geometry["coordinates"],
    }

    try:
        # Lazy import avoids a circular import: main.py registers this router.
        from backend import main as forest_api

        if request.collection == "sentinel-1-grd":
            typed_geometry = forest_api.GeoJSONGeometry(**geojson_geometry)
            result = forest_api.get_sar_analysis(forest_api.SARAnalysisRequest(
                geometry=typed_geometry,
                startDate=request.date.isoformat(),
                endDate=request.date.isoformat(),
                productId=request.productId,
            ))
            processor = "forest.sar"
        elif request.collection in ("sentinel-2-l2a", "landsat-c2-l2"):
            typed_geometry = forest_api.GeoJSONGeometry(**geojson_geometry)
            result = forest_api.calculate_ndvi(forest_api.NDVIAnalysisRequest(
                geometry=typed_geometry,
                date=request.date.isoformat(),
                productId=request.productId,
                collection=request.collection,
            ))
            processor = "forest.ndvi"
        else:
            raise HTTPException(status_code=422, detail="No existe un procesador para esta colección.")

        raw_status = result.get("status")
        processed = raw_status == "REAL"
        return {
            "status": "PROCESSED" if processed else "PROCESSING_UNAVAILABLE",
            "sceneId": request.productId,
            "collection": request.collection,
            "requestedDate": request.date.isoformat(),
            "processor": processor,
            "assetAccessVerified": processed,
            "result": result,
            "limitations": [
                "El procesamiento se delega al procesador especializado existente; el motor no duplica sus fórmulas ni máscaras.",
                "assetAccessVerified=true significa que el procesador pudo leer los activos necesarios y producir píxeles válidos, no que todos los assets opcionales de la escena hayan sido descargados.",
                "La escena debe haber sido descubierta para el mismo AOI y fecha; el ID se vuelve a comprobar en el catálogo antes del procesamiento.",
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falló el procesador especializado: {type(exc).__name__}: {str(exc)[:240]}")



@router.post("/analyze")
def analyze_existing_dataset(request: DatasetAnalysisRequest):
    """Dispatch an allow-listed territorial dataset analysis to its existing specialist."""
    allowed = {"gaez", "gfw", "hansen", "gfw-drivers", "jrc"}
    if request.processor not in allowed:
        raise HTTPException(status_code=422, detail="Procesador territorial no admitido.")
    geom = _validated_geometry(request.geometry)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise HTTPException(status_code=422, detail="El análisis territorial requiere Polygon o MultiPolygon.")
    geometry = mapping(geom)

    try:
        from backend import territorial_analysis, open_forest_data

        if request.processor in ("gaez", "gfw"):
            specialist_request = territorial_analysis.LotDatasetRequest(
                geometry=geometry,
                mapset_code=request.mapset_code,
                crop=request.crop,
                period=request.period,
                climate_data_source=request.climate_data_source,
                ssp=request.ssp,
                input_level=request.input_level,
            )
            handler = territorial_analysis.gaez_analyze if request.processor == "gaez" else territorial_analysis.gfw_analyze
        else:
            specialist_request = open_forest_data.ForestLotRequest(geometry=geometry)
            handler = {
                "hansen": open_forest_data.hansen_analyze,
                "gfw-drivers": open_forest_data.gfw_drivers_analyze,
                "jrc": open_forest_data.jrc_analyze,
            }[request.processor]

        result = handler(specialist_request)
        successful = result.get("success") is True
        return {
            "status": "PROCESSED" if successful else "PROCESSING_UNAVAILABLE",
            "processor": request.processor,
            "result": result,
            "provenancePreserved": True,
            "limitations": [
                "El motor delega el cálculo al procesador especializado existente y conserva su procedencia y limitaciones.",
                "Las resoluciones y períodos son propios de cada producto; no se consideran equivalentes entre fuentes.",
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falló el procesador territorial {request.processor}: {type(exc).__name__}: {str(exc)[:240]}")


class TerrainAnalysisRequest(BaseModel):
    geometry: dict[str, Any]


class ComparisonLot(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    geometry: dict[str, Any]


class LotComparisonRequest(BaseModel):
    lots: list[ComparisonLot] = Field(min_length=2, max_length=5)
    processors: list[str] = Field(default_factory=lambda: ["hansen", "gfw-drivers", "jrc"], min_length=1, max_length=5)
    mapset_code: str | None = None
    crop: str | None = None
    period: str | None = None
    climate_data_source: str | None = None
    ssp: str | None = None
    input_level: str | None = None
    spectral_date: dt.date | None = None
    spectral_collection: str = "auto"
    spectral_indices: list[str] = Field(default_factory=lambda: ["ndvi", "evi", "ndmi", "gndvi", "ndre"])


COMPARISON_PROCESSORS = {"gaez", "gfw", "hansen", "gfw-drivers", "jrc", "spectral", "terrain"}


def _numeric_metrics(value: Any, prefix: str = "") -> dict[str, float]:
    """Extract comparable analytical values, excluding pixel/record counters and metadata."""
    metrics: dict[str, float] = {}
    excluded = {
        "pixels", "valid_pixels", "validpixels", "tiles_read", "tilesread",
        "samplecount", "sample_count", "pixel_count", "validpixelspercent",
        "resolution", "resolution_native_units", "cloudcover", "cloud_cover",
        "code", "count", "total_pixels", "roi_pixel_count"
    }
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if str(key).casefold() in excluded:
                continue
            metrics.update(_numeric_metrics(child, path))
    elif isinstance(value, list):
        # Driver classes have stable source codes; arbitrary positional arrays do not.
        for child in value:
            if not isinstance(child, dict):
                continue
            identity = child.get("code")
            label = child.get("driver") or child.get("class") or child.get("label")
            if identity is None or not label:
                continue
            path = f"{prefix}[{identity}:{label}]"
            metrics.update(_numeric_metrics(child, path))
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number) and prefix:
            metrics[prefix] = number
    return metrics


def _run_comparison_processor(processor: str, geometry: dict, request: LotComparisonRequest):
    from backend import territorial_analysis, open_forest_data

    if processor in ("gaez", "gfw"):
        specialist_request = territorial_analysis.LotDatasetRequest(
            geometry=geometry,
            mapset_code=request.mapset_code,
            crop=request.crop,
            period=request.period,
            climate_data_source=request.climate_data_source,
            ssp=request.ssp,
            input_level=request.input_level,
        )
        handler = territorial_analysis.gaez_analyze if processor == "gaez" else territorial_analysis.gfw_analyze
    elif processor == "spectral":
        from backend import main as forest_api
        specialist_request = forest_api.SpectralAnalysisRequest(
            geometry=geometry,
            date=request.spectral_date.isoformat() if request.spectral_date else None,
            collection=request.spectral_collection,
            indices=request.spectral_indices,
        )
        return forest_api.calculate_spectral_indices(specialist_request)
    elif processor == "terrain":
        return analyze_terrain(TerrainAnalysisRequest(geometry=geometry))
    else:
        specialist_request = open_forest_data.ForestLotRequest(geometry=geometry)
        handler = {
            "hansen": open_forest_data.hansen_analyze,
            "gfw-drivers": open_forest_data.gfw_drivers_analyze,
            "jrc": open_forest_data.jrc_analyze,
        }[processor]
    return handler(specialist_request)



DEM_PROVIDER = {
    "provider": "AWS Earth Search",
    "endpoint": "https://earth-search.aws.element84.com/v1/search",
    "collection": "cop-dem-glo-30",
    "product": "Copernicus DEM GLO-30",
    "kind": "elevation",
    "catalog": "https://earth-search.aws.element84.com/v1/collections/cop-dem-glo-30",
}


def _copernicus_dem_asset_url(href: str) -> str:
    prefix = "s3://copernicus-dem-30m/"
    if href.startswith(prefix):
        key = href[len(prefix):]
        return "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/" + key
    parsed = urllib.parse.urlparse(href)
    if parsed.scheme == "https" and parsed.netloc == "copernicus-dem-30m.s3.eu-central-1.amazonaws.com":
        return href
    raise ValueError("El catálogo DEM devolvió un asset fuera del bucket público autorizado.")


@router.post("/terrain")
def analyze_terrain(request: TerrainAnalysisRequest):
    """Zonal elevation, slope and aspect from Copernicus DEM GLO-30 (DSM)."""
    import numpy as np
    try:
        import rasterio
        from rasterio.merge import merge
        from rasterio.warp import reproject, Resampling
        from rasterio.features import geometry_mask
        from affine import Affine

        geom = _validated_geometry(request.geometry)
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            raise HTTPException(status_code=422, detail="El análisis de elevación requiere un polígono o multipolígono.")
        west, south, east, north = geom.bounds
        search_body = {
            "collections": ["cop-dem-glo-30"],
            "intersects": mapping(geom),
            "limit": 100,
        }
        features, has_more, pages = _read_stac_pages(
            DEM_PROVIDER, search_body, max_pages=5, max_items=100
        )
        if not features:
            return {
                "status": "UNAVAILABLE",
                "source": "Copernicus DEM GLO-30",
                "message": "El catálogo no devolvió teselas de elevación para el polígono consultado."
            }

        datasets = []
        env = rasterio.Env(
            AWS_NO_SIGN_REQUEST="YES",
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
            CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
            GDAL_HTTP_MULTIRANGE="YES",
            CPL_VSIL_CURL_USE_HEAD="NO",
            GDAL_HTTP_TIMEOUT="25",
        )
        env.__enter__()
        try:
            for item in features:
                asset = (item.get("assets") or {}).get("data") or {}
                href = asset.get("href")
                if not href:
                    continue
                url = _copernicus_dem_asset_url(href)
                datasets.append(rasterio.open(url))
            if not datasets:
                return {
                    "status": "UNAVAILABLE",
                    "source": "Copernicus DEM GLO-30",
                    "message": "Las teselas encontradas no publican un asset de elevación accesible."
                }
            source_crs = datasets[0].crs
            mosaic, src_transform = merge(
                datasets,
                bounds=(west, south, east, north),
                nodata=np.nan,
                res=(1 / 3600, 1 / 3600),
            )
            if mosaic.size == 0:
                return {
                    "status": "UNAVAILABLE",
                    "source": "Copernicus DEM GLO-30",
                    "message": "Las teselas no contienen píxeles dentro del polígono."
                }
            lon, lat = geom.centroid.x, geom.centroid.y
            zone = int((lon + 180) // 6) + 1
            epsg = (32600 if lat >= 0 else 32700) + zone
            target_crs = f"EPSG:{epsg}"
            projected_geom = shape({
                "type": "Polygon",
                "coordinates": [[
                    [x, y] for x, y in []
                ]]
            }) if False else geom
            from pyproj import Transformer
            from shapely.ops import transform as transform_shape
            transformer = Transformer.from_crs("EPSG:4326", target_crs, always_xy=True)
            projected_geom = transform_shape(transformer.transform, geom)
            minx, miny, maxx, maxy = projected_geom.bounds
            resolution_m = 30.0
            width = max(1, int(math.ceil((maxx - minx) / resolution_m)))
            height = max(1, int(math.ceil((maxy - miny) / resolution_m)))
            if width * height > 2_000_000:
                raise HTTPException(status_code=413, detail="El área supera 2 millones de píxeles a 30 m por consulta.")
            dst_transform = Affine(resolution_m, 0, minx, 0, -resolution_m, maxy)
            elevation = np.full((height, width), np.nan, dtype="float32")
            source_nodata = datasets[0].nodata if datasets[0].nodata is not None else -9999
            source = mosaic[0].astype("float32")
            source[~np.isfinite(source)] = np.nan
            reproject(
                source=source,
                destination=elevation,
                src_transform=src_transform,
                src_crs=source_crs,
                src_nodata=np.nan if np.isnan(source).any() else source_nodata,
                dst_transform=dst_transform,
                dst_crs=target_crs,
                dst_nodata=np.nan,
                resampling=Resampling.bilinear,
            )
            inside = geometry_mask(
                [mapping(projected_geom)],
                out_shape=elevation.shape,
                transform=dst_transform,
                invert=True,
            )
            elevation[~inside] = np.nan
            valid_elevation = np.isfinite(elevation)
            elevation_values = elevation[valid_elevation]
            if elevation_values.size < 9:
                return {
                    "status": "UNAVAILABLE",
                    "source": "Copernicus DEM GLO-30",
                    "message": "El polígono no contiene suficientes píxeles de 30 m para derivar pendiente y orientación."
                }
            dz_dy, dz_dx = np.gradient(elevation, resolution_m, -resolution_m)
            slope = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))
            slope_valid = valid_elevation & np.isfinite(slope)
            slope_values = slope[slope_valid]
            aspect = np.mod(
                np.degrees(np.arctan2(-dz_dx, -dz_dy)), 360.0
            )
            aspect_valid = slope_valid & (slope >= 0.5) & np.isfinite(aspect)
            aspect_values = aspect[aspect_valid]
            if aspect_values.size:
                mean_aspect = float(np.mod(
                    np.degrees(np.arctan2(
                        np.mean(np.sin(np.radians(aspect_values))),
                        np.mean(np.cos(np.radians(aspect_values)))
                    )), 360.0
                ))
            else:
                mean_aspect = None
            return {
                "status": "REAL",
                "source": "Copernicus DEM GLO-30",
                "sourceUrl": "https://earth-search.aws.element84.com/v1/collections/cop-dem-glo-30",
                "model": "DSM",
                "resolution": resolution_m,
                "resolutionUnit": "m",
                "horizontalCrs": target_crs,
                "verticalDatum": "EGM2008",
                "elevation": {
                    "min_m": round(float(np.min(elevation_values)), 2),
                    "mean_m": round(float(np.mean(elevation_values)), 2),
                    "median_m": round(float(np.median(elevation_values)), 2),
                    "max_m": round(float(np.max(elevation_values)), 2),
                    "sample_count": int(elevation_values.size),
                },
                "slope": {
                    "mean_deg": round(float(np.mean(slope_values)), 3),
                    "median_deg": round(float(np.median(slope_values)), 3),
                    "max_deg": round(float(np.max(slope_values)), 3),
                    "sample_count": int(slope_values.size),
                },
                "aspect": {
                    "circular_mean_deg": round(mean_aspect, 2) if mean_aspect is not None else None,
                    "sample_count": int(aspect_values.size),
                },
                "catalog": {
                    "tiles_read": len(datasets),
                    "pages_read": pages,
                    "has_more_tiles": has_more,
                },
                "limitations": [
                    "Copernicus GLO-30 es un modelo digital de superficie (DSM): las alturas incluyen vegetación y construcciones; no es un modelo de terreno desnudo.",
                    "La pendiente y orientación se derivan de una grilla de 30 m y no sirven para diseño de drenajes, caminos o movimiento de suelo de precisión.",
                    "La cobertura GLO-30 tiene algunas teselas no publicadas; si el catálogo no cubre el lote, el resultado se informa como no disponible.",
                ],
            }
        finally:
            for dataset in datasets:
                dataset.close()
            env.__exit__(None, None, None)
    except HTTPException:
        raise
    except Exception as exc:
        return {
            "status": "UNAVAILABLE",
            "source": "Copernicus DEM GLO-30",
            "message": f"No se pudo procesar el modelo de elevación: {type(exc).__name__}: {str(exc)[:240]}"
        }


@router.post("/compare")
def compare_lots(request: LotComparisonRequest):
    """Run identical allow-listed dataset processors for 2–5 lots and return comparable metrics."""
    if len({lot.id for lot in request.lots}) != len(request.lots):
        raise HTTPException(status_code=422, detail="Cada lote debe tener un id único.")
    if len({lot.name.strip().casefold() for lot in request.lots}) != len(request.lots):
        raise HTTPException(status_code=422, detail="Cada lote debe tener un nombre distinto.")
    unknown = sorted(set(request.processors) - COMPARISON_PROCESSORS)
    if unknown:
        raise HTTPException(status_code=422, detail="Procesadores no admitidos: " + ", ".join(unknown))
    processors = list(dict.fromkeys(request.processors))
    if "gaez" in processors:
        missing = [name for name in ("mapset_code", "crop", "period", "climate_data_source", "ssp", "input_level")
                   if not getattr(request, name)]
        if missing:
            raise HTTPException(status_code=422, detail="GAEZ requiere parámetros comunes para todos los lotes: " + ", ".join(missing))

    validated_lots = []
    for lot in request.lots:
        geom = _validated_geometry(lot.geometry)
        if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.area <= 0:
            raise HTTPException(status_code=422, detail=f"El lote {lot.name} debe ser un polígono con superficie.")
        validated_lots.append((lot, mapping(geom), geom))

    results = []
    for lot, geometry, geom in validated_lots:
        lot_result = {
            "id": lot.id,
            "name": lot.name,
            "areaHa": None,
            "datasets": {},
        }
        try:
            from backend.main import calculate_shapely_area
            lot_result["areaHa"] = round(calculate_shapely_area(geom) / 10000.0, 4)
        except Exception:
            pass
        for processor in processors:
            try:
                result = _run_comparison_processor(processor, geometry, request)
                success = result.get("success") is True or result.get("status") == "REAL"
                lot_result["datasets"][processor] = {
                    "status": "PROCESSED" if success else "PROCESSING_UNAVAILABLE",
                    "result": result,
                }
            except HTTPException as exc:
                lot_result["datasets"][processor] = {
                    "status": "PROCESSING_UNAVAILABLE",
                    "error": exc.detail,
                }
            except Exception as exc:
                lot_result["datasets"][processor] = {
                    "status": "PROCESSING_UNAVAILABLE",
                    "error": f"{type(exc).__name__}: {str(exc)[:180]}",
                }
        results.append(lot_result)

    comparisons = {}
    chart_series = {}
    for processor in processors:
        per_lot = {}
        metric_paths = None
        for lot_result in results:
            dataset = lot_result["datasets"][processor]
            if dataset["status"] != "PROCESSED":
                per_lot[lot_result["id"]] = {}
                continue
            metrics = _numeric_metrics(dataset.get("result", {}))
            per_lot[lot_result["id"]] = metrics
            paths = set(metrics)
            metric_paths = paths if metric_paths is None else metric_paths.intersection(paths)
        comparison_note = None
        if processor == "spectral":
            scene_signatures = {
                (
                    (lot_result["datasets"][processor].get("result") or {}).get("date"),
                    (lot_result["datasets"][processor].get("result") or {}).get("collection"),
                    (lot_result["datasets"][processor].get("result") or {}).get("resolution"),
                )
                for lot_result in results
                if lot_result["datasets"][processor]["status"] == "PROCESSED"
            }
            if len(scene_signatures) != 1 or len(scene_signatures) == 0:
                metric_paths = set()
                comparison_note = "No se comparan índices espectrales porque los lotes no tienen la misma fecha de adquisición, colección y resolución."
        rows = []
        for path in sorted(metric_paths or []):
            values = [{"lotId": lot["id"], "lotName": lot["name"], "value": per_lot[lot["id"]][path]}
                      for lot in results if path in per_lot.get(lot["id"], {})]
            if len(values) == len(results):
                baseline = values[0]["value"]
                for item in values:
                    item["differenceFromFirst"] = item["value"] - baseline
                    item["differencePercentFromFirst"] = (
                        ((item["value"] - baseline) / abs(baseline)) * 100.0 if baseline != 0 else None
                    )
                rows.append({"metric": path, "values": values})
        comparisons[processor] = rows
        chart_series[processor] = [
            {"metric": row["metric"], "series": [
                {"name": item["lotName"], "lotId": item["lotId"], "value": item["value"]}
                for item in row["values"]
            ]}
            for row in rows
        ]

    statuses = [dataset["status"] for lot in results for dataset in lot["datasets"].values()]
    overall = "PROCESSED" if statuses and all(status == "PROCESSED" for status in statuses) else (
        "PARTIAL" if any(status == "PROCESSED" for status in statuses) else "PROCESSING_UNAVAILABLE"
    )
    return {
        "status": overall,
        "comparisonMethod": "Same allow-listed processor and identical dataset parameters applied independently to each lot.",
        "lots": results,
        "comparisons": comparisons,
        "chartSeries": chart_series,
        "comparisonNotes": {
            processor: "No se comparan índices espectrales porque los lotes no tienen la misma fecha de adquisición, colección y resolución."
            for processor in processors
            if processor == "spectral" and not comparisons.get(processor)
        },
        "processors": processors,
        "limitations": [
            "Los valores solo se comparan cuando el mismo procesador devuelve la misma ruta métrica para todos los lotes.",
            "Las resoluciones, períodos, unidades y metodologías pertenecen a cada fuente; no se mezclan métricas entre procesadores.",
            "La comparación describe las variables publicadas por las fuentes. No demuestra causalidad ni rendimiento cosechado.",
            "Para comparar productividad real se necesitan registros de producción y superficie cosechada por lote y campaña.",
            "Un resultado ausente o no procesado no se convierte en cero.",
        ],
    }


@router.get("/sources")
def engine_source_catalog():
    """Expose the existing official-source registry through the central engine."""
    from backend import source_catalog
    return source_catalog.get_source_catalog()


@router.get("/ogc/{provider}/{service}")
def engine_ogc_capabilities(provider: str, service: str, layer_filter: str | None = None):
    """Delegate OGC GetCapabilities to the existing provider allow-list."""
    from backend import source_catalog
    return source_catalog.get_ogc_capabilities(provider, service, layer_filter)


@router.get("/mapbiomas/tiles/{year}")
def engine_mapbiomas_tiles(year: int):
    """Delegate MapBiomas Argentina tile discovery to its existing adapter."""
    from backend import source_catalog
    return source_catalog.get_mapbiomas_tiles(year)


@router.get("/capabilities")
def engine_capabilities():
    """Describe supported discovery providers without asserting live availability."""
    return {
        "engine": "Agro-Consultas geospatial acquisition engine",
        "version": "1.0.0",
        "status": "DISCOVERY_AND_PROCESSING_READY",
        "spatialReference": "OGC:CRS84 / WGS84 longitude-latitude GeoJSON",
        "providers": [
            {
                "collection": key,
                "product": value["product"],
                "provider": value["provider"],
                "kind": value["kind"],
                "catalog": value["catalog"],
                "coverage": "Global catalog; effective scene availability is evaluated per AOI and date at request time.",
            }
            for key, value in PROVIDERS.items()
        ],
        "processing": {
            "sentinel1": "Existing Forestal SAR processor; exact-scene Sigma0 calibration status and limitations are returned by that processor.",
            "sentinel2": "Existing Forestal NDVI plus calibrated multispectral NDVI, EVI, NDMI, GNDVI and NDRE with SCL quality mask.",
            "landsat": "Existing Forestal NDVI processor with QA_PIXEL quality mask.",
            "territorial": ["gaez", "gfw", "hansen", "gfw-drivers", "jrc"],
            "multispectral": "POST /api/forest/spectral calculates calibrated NDVI, EVI, NDMI, GNDVI and NDRE from Sentinel-2/Landsat assets with aligned QA masks.",
            "terrain": "Copernicus DEM GLO-30 DSM zonal elevation, slope and aspect in a local metric CRS.",
            "lotComparison": "Same allow-listed territorial processors applied to 2–5 lots; returns comparable metrics and chart-ready series. Spectral comparisons require matching acquisition date, collection and resolution.",
        },
        "dispatchEndpoints": {
            "sceneDiscovery": "POST /api/engine/scenes",
            "sceneProcessing": "POST /api/engine/process",
            "territorialAnalysis": "POST /api/engine/analyze",
            "multispectralAnalysis": "POST /api/forest/spectral",
            "terrainAnalysis": "POST /api/engine/terrain",
            "lotComparison": "POST /api/engine/compare",
            "officialSources": "GET /api/engine/sources",
            "ogcCapabilities": "GET /api/engine/ogc/{provider}/{service}",
            "mapbiomasTiles": "GET /api/engine/mapbiomas/tiles/{year}",
        },
        "limitations": [
            "POST /scenes discovers and normalizes scenes; POST /process delegates one exact scene to the existing specialized raster processor.",
            "Scene coverage and asset accessibility must be verified per request.",
            "A catalog timeout or error is reported as an upstream error, never as zero scenes.",
            "The current cache is process-local and expires after 10 minutes.",
        ],
    }


@router.post("/scenes")
def discover_scenes(request: SceneSearchRequest):
    """Discover real satellite scenes intersecting any valid WGS84 AOI."""
    if request.endDate < request.startDate:
        raise HTTPException(status_code=422, detail="endDate debe ser igual o posterior a startDate.")
    if (request.endDate - request.startDate).days > 3650:
        raise HTTPException(status_code=422, detail="El período máximo por consulta es de 10 años.")
    if not request.collections:
        raise HTTPException(status_code=422, detail="Seleccioná al menos una colección satelital.")
    unknown = sorted(set(request.collections) - set(PROVIDERS))
    if unknown:
        raise HTTPException(status_code=422, detail="Colecciones no admitidas: " + ", ".join(unknown))
    collections = list(dict.fromkeys(request.collections))
    geom = _validated_geometry(request.geometry)
    geometry = mapping(geom)
    key = _cache_key(geometry, request.startDate, request.endDate, collections, request.limit)
    cached = _cache_get(key)
    if cached is not None:
        return {**cached, "meta": {**cached["meta"], "cacheHit": True}}

    interval = (
        request.startDate.isoformat() + "T00:00:00Z/"
        + request.endDate.isoformat() + "T23:59:59Z"
    )
    scenes = []
    providers = []
    errors = []
    has_more = False
    successful_providers = 0

    def query_collection(collection):
        provider = PROVIDERS[collection]
        body = {
            "collections": [collection],
            "intersects": geometry,
            "datetime": interval,
            "limit": request.limit,
        }
        features, remaining, pages = _read_stac_pages(provider, body, max_items=request.limit)
        return collection, provider, features, remaining, pages

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(3, len(collections))) as executor:
        futures = {executor.submit(query_collection, collection): collection for collection in collections}
        for future in concurrent.futures.as_completed(futures):
            collection = futures[future]
            provider = PROVIDERS[collection]
            try:
                _collection, provider, features, remaining, pages = future.result()
                scenes.extend(_normalize_scene(item, provider) for item in features)
                has_more = has_more or remaining
                successful_providers += 1
                providers.append({
                    "collection": collection,
                    "provider": provider["provider"],
                    "status": "OK",
                    "returned": len(features),
                    "pagesRead": pages,
                    "hasMore": remaining,
                })
            except Exception as exc:
                errors.append({
                    "collection": collection,
                    "provider": provider["provider"],
                    "status": "UPSTREAM_ERROR",
                    "message": f"{type(exc).__name__}: {str(exc)[:180]}",
                })
                providers.append({
                    "collection": collection,
                    "provider": provider["provider"],
                    "status": "ERROR",
                    "returned": 0,
                    "pagesRead": 0,
                    "hasMore": False,
                })

    scenes.sort(key=lambda item: (item.get("datetime") or "", item.get("id") or ""), reverse=True)
    providers.sort(key=lambda item: item["collection"])
    errors.sort(key=lambda item: item["collection"])
    status = "OK" if not errors else ("PARTIAL" if successful_providers else "UPSTREAM_ERROR")
    result = {
        "status": status,
        "scenes": scenes,
        "meta": {
            "requestedCollections": collections,
            "startDate": request.startDate.isoformat(),
            "endDate": request.endDate.isoformat(),
            "sceneCount": len(scenes),
            "providers": providers,
            "errors": errors,
            "hasMore": has_more,
            "limitPerCollection": request.limit,
            "aoiType": geom.geom_type,
            "aoiBounds": list(geom.bounds),
            "spatialReference": "OGC:CRS84 / WGS84",
            "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "cacheHit": False,
            "cacheTtlSeconds": CACHE_TTL_SECONDS,
        },
        "limitations": [
            "INTERSECTS_AOI indica intersección de la huella STAC; no garantiza cobertura completa.",
            "Los resultados son escenas identificadas, no análisis raster ni observaciones de campo.",
            "Las URLs de assets se exponen para inspección; su lectura/descarga debe comprobarse en el procesador correspondiente.",
            "La disponibilidad de colecciones depende del catálogo y del período consultado.",
        ],
    }
    # Do not cache incomplete or failed discovery responses; a later request retries failed providers.
    if status == "OK":
        _cache_put(key, result)
    return result
