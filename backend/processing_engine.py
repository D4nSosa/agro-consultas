"""On-demand geospatial acquisition engine.

This first engine layer centralizes AOI validation, allow-listed STAC discovery,
scene metadata normalization and bounded caching. It discovers products only;
the existing Forestal processors remain responsible for NDVI and Sentinel-1
radiometric processing. No asset is treated as processed merely because it exists.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
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
    return payload


def _read_stac_pages(provider: dict, body: dict, max_pages: int = 5) -> tuple[list[dict], bool, int]:
    payload = _read_stac_page(provider, body)
    features = list(payload.get("features") or [])
    pages = 1
    next_link = next(
        (link for link in (payload.get("links") or []) if isinstance(link, dict) and link.get("rel") == "next"),
        None,
    )
    while next_link and pages < max_pages:
        payload = _read_stac_next_page(provider, next_link)
        page_features = payload.get("features") or []
        if not isinstance(page_features, list):
            raise ValueError("El catálogo devolvió una lista features inválida.")
        features.extend(item for item in page_features if isinstance(item, dict))
        pages += 1
        next_link = next(
            (link for link in (payload.get("links") or []) if isinstance(link, dict) and link.get("rel") == "next"),
            None,
        )
    return features, bool(next_link), pages


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
            "sentinel2": "Existing Forestal NDVI processor with SCL quality mask.",
            "landsat": "Existing Forestal NDVI processor with QA_PIXEL quality mask.",
            "territorial": ["gaez", "gfw", "hansen", "gfw-drivers", "jrc"],
        },
        "dispatchEndpoints": {
            "sceneDiscovery": "POST /api/engine/scenes",
            "sceneProcessing": "POST /api/engine/process",
            "territorialAnalysis": "POST /api/engine/analyze",
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

    def query_collection(collection):
        provider = PROVIDERS[collection]
        body = {
            "collections": [collection],
            "intersects": geometry,
            "datetime": interval,
            "limit": request.limit,
        }
        features, remaining, pages = _read_stac_pages(provider, body)
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

    scenes.sort(key=lambda item: item.get("datetime") or "", reverse=True)
    status = "OK" if not errors else ("PARTIAL" if scenes else "UPSTREAM_ERROR")
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
