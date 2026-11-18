"""Anonymous, public raster sources for lot-level forest context.

Sources:
- Hansen/UMD Global Forest Change 2025 v1.13 (30 m, annual gross tree-cover loss).
- WRI/Google DeepMind dominant drivers of tree-cover loss v1.3 (about 1 km).
- JRC Global Forest Cover 2020 v4 (10 m forest/non-forest baseline).

All calculations are zonal summaries over a user-supplied polygon. Remote COG reads
use GDAL range requests; no account or API key is required.
"""
from __future__ import annotations

import datetime as dt
import math
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from shapely.geometry import box, mapping

from backend.territorial_analysis import _polygon

router = APIRouter(prefix="/api/territorial/forest", tags=["Open forest datasets"])

HANSEN_BASE = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13"
HANSEN_VERSION = "GFC-2025-v1.13"
GFW_DRIVERS_COG = "https://data.source.coop/epoch/global-forest-loss-drivers/v1_3/drivers_forest_loss_1km_2001_2025_v1_3.tif"
JRC_COG = "https://data.source.coop/epoch/jrc-global-forest-cover-2020/v4/JRC_GFC2020_V4_COG.tif"

DRIVER_CLASSES = {
    1: "Agricultura permanente",
    2: "Materias primas (commodities)",
    3: "Agricultura itinerante",
    4: "Tala / aprovechamiento forestal",
    5: "Incendios",
    6: "Asentamientos e infraestructura",
    7: "Otras perturbaciones naturales",
}


class ForestLotRequest(BaseModel):
    geometry: dict[str, Any]


def _remote_raster(url: str):
    import rasterio
    env = rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_MULTIRANGE="YES",
        CPL_VSIL_CURL_USE_HEAD="NO",
        GDAL_HTTP_TIMEOUT="35",
    )
    env.__enter__()
    try:
        dataset = rasterio.open("/vsicurl/" + url)
    except Exception:
        env.__exit__(None, None, None)
        raise
    return env, dataset


def _row_pixel_area_ha(transform, row: int) -> float:
    """Geodesic area of one EPSG:4326 pixel at this raster row."""
    from pyproj import Geod
    geod = Geod(ellps="WGS84")
    x0, y0 = transform * (0, row)
    x1, y1 = transform * (1, row)
    _, y2 = transform * (0, row + 1)
    area, _ = geod.polygon_area_perimeter(
        [x0, x1, x1, x0], [y0, y0, y2, y2]
    )
    return abs(area) / 10000.0


def _class_area_stats(values, mask, transform, classes):
    import numpy as np
    result = {int(code): {"pixels": 0, "area_ha": 0.0} for code in classes}
    valid_total = 0
    for row in range(values.shape[0]):
        valid = ~mask[row]
        if not np.any(valid):
            continue
        row_values = values[row][valid]
        valid_total += int(row_values.size)
        pixel_area = _row_pixel_area_ha(transform, row)
        unique, counts = np.unique(row_values, return_counts=True)
        for raw_code, count in zip(unique, counts):
            code = int(raw_code)
            if code in result:
                result[code]["pixels"] += int(count)
                result[code]["area_ha"] += float(count) * pixel_area
    for item in result.values():
        item["area_ha"] = round(item["area_ha"], 4)
    return result, valid_total


def _hansen_tile_code(value: float, axis: str) -> str:
    if axis == "lat":
        if value >= 0:
            origin = int(math.floor(value / 10) * 10)
            return f"{origin:02d}N"
        origin = int(math.floor(abs(value) / 10) * 10)
        return f"{origin:02d}S"
    if value >= 0:
        origin = int(math.floor(value / 10) * 10)
        return f"{origin:03d}E"
    origin = int(math.floor(abs(value) / 10) * 10)
    return f"{origin:03d}W"


def _hansen_tile_origins(bounds):
    minx, miny, maxx, maxy = bounds
    xs = range(math.floor(minx / 10) * 10, math.floor(maxx / 10) * 10 + 1, 10)
    # Hansen names southern tiles by their northern edge (e.g. 30S covers 30-40S).
    ys = set()
    for lat in (miny, maxy):
        if lat < 0:
            ys.add(-int(math.floor(abs(lat) / 10) * 10))
        else:
            ys.add(int(math.floor(lat / 10) * 10))
    if miny < 0 < maxy:
        ys.update(range(0, int(math.floor(maxy / 10) * 10) + 1, 10))
        ys.update(range(-10, -int(math.floor(abs(miny) / 10) * 10) - 1, -10))
    else:
        low, high = sorted(ys)
        ys.update(range(low, high + 1, 10))
    return [(x, y) for x in xs for y in sorted(ys)]


def _hansen_tile_bbox(x: int, y: int):
    return box(x, y - 10, x + 10, y)


def _read_hansen_layer(geometry, layer: str):
    import numpy as np
    from rasterio.mask import mask as raster_mask

    loss_by_year: dict[int, dict[str, float]] = {}
    canopy_values = []
    total_pixels = 0
    successful_tiles = 0
    origins = _hansen_tile_origins(geometry.bounds)
    if len(origins) > 25:
        raise HTTPException(status_code=413, detail="El polígono cruza demasiadas teselas Hansen. Dividí el área para analizarla.")
    for x, y in origins:
        tile = _hansen_tile_bbox(x, y)
        part = geometry.intersection(tile)
        if part.is_empty:
            continue
        lat_code = _hansen_tile_code(y, "lat")
        lon_code = _hansen_tile_code(x, "lon")
        filename = f"Hansen_{HANSEN_VERSION}_{layer}_{lat_code}_{lon_code}.tif"
        url = f"{HANSEN_BASE}/{filename}"
        env = dataset = None
        try:
            env, dataset = _remote_raster(url)
            if dataset.crs is None:
                continue
            projected = mapping(part)
            if dataset.crs.to_string() != "EPSG:4326":
                from rasterio.warp import transform_geom
                projected = transform_geom("EPSG:4326", dataset.crs, projected)
            data, transform = raster_mask(dataset, [projected], crop=True, filled=False)
            band = data[0]
            values = band.compressed()
            if not values.size:
                continue
            successful_tiles += 1
            total_pixels += int(values.size)
            if layer == "treecover2000":
                valid = values[np.isfinite(values)]
                if valid.size:
                    canopy_values.extend(valid.tolist())
            elif layer == "lossyear":
                for row in range(band.shape[0]):
                    row_values = band.data[row][~np.ma.getmaskarray(band)[row]]
                    if not row_values.size:
                        continue
                    pixel_area = _row_pixel_area_ha(transform, row)
                    unique, counts = np.unique(row_values, return_counts=True)
                    for code, count in zip(unique, counts):
                        year_code = int(code)
                        if 1 <= year_code <= 25:
                            year = 2000 + year_code
                            item = loss_by_year.setdefault(year, {"pixels": 0, "area_ha": 0.0})
                            item["pixels"] += int(count)
                            item["area_ha"] += float(count) * pixel_area
        except Exception:
            # Missing ocean/edge granules are skipped; the endpoint fails if none intersect.
            continue
        finally:
            if dataset is not None:
                dataset.close()
            if env is not None:
                env.__exit__(None, None, None)
    if successful_tiles == 0:
        raise HTTPException(status_code=502, detail="No se pudieron leer teselas públicas Hansen para la geometría.")
    for item in loss_by_year.values():
        item["area_ha"] = round(item["area_ha"], 4)
    canopy = {
        "pixel_count": len(canopy_values),
        "mean_percent": round(float(np.mean(canopy_values)), 2) if canopy_values else None,
        "median_percent": round(float(np.median(canopy_values)), 2) if canopy_values else None,
        "p90_percent": round(float(np.percentile(canopy_values, 90)), 2) if canopy_values else None,
    }
    return {"loss_by_year": dict(sorted(loss_by_year.items())), "tree_cover_2000": canopy,
            "valid_pixels": total_pixels, "tiles_read": successful_tiles}


def _read_single_cog(geometry, url: str, band_index: int = 1):
    from rasterio.mask import mask as raster_mask
    env, dataset = _remote_raster(url)
    try:
        if dataset.crs is None:
            raise ValueError("El COG no declara CRS.")
        projected = mapping(geometry)
        if dataset.crs.to_string() != "EPSG:4326":
            from rasterio.warp import transform_geom
            projected = transform_geom("EPSG:4326", dataset.crs, projected)
        data, transform = raster_mask(dataset, [projected], crop=True, filled=False, indexes=band_index)
        band = data if data.ndim == 2 else data[0]
        values = band.data
        mask = __import__("numpy").ma.getmaskarray(band)
        return values, mask, transform, dataset.crs.to_string(), dataset.res
    finally:
        dataset.close()
        env.__exit__(None, None, None)


@router.post("/hansen/analyze")
def hansen_analyze(req: ForestLotRequest):
    """Hansen GFC 2025: tree cover baseline and annual gross tree-cover loss."""
    geometry = _polygon(req.geometry)
    canopy = _read_hansen_layer(geometry, "treecover2000")
    loss = _read_hansen_layer(geometry, "lossyear")
    return {
        "success": True,
        "source": "Hansen/UMD/Google/USGS/NASA Global Forest Change 2025 v1.13",
        "source_url": "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html",
        "license": "CC-BY-4.0",
        "resolution": "1 arc-second (approximately 30 m at the equator)",
        "tree_cover_2000": canopy["tree_cover_2000"],
        "loss_by_year": loss["loss_by_year"],
        "valid_pixels": min(canopy["valid_pixels"], loss["valid_pixels"]),
        "tiles_read": min(canopy["tiles_read"], loss["tiles_read"]),
        "method": "Conteo de píxeles por año de pérdida y estadísticos de cobertura arbórea de referencia sobre el polígono.",
        "limitations": [
            "La pérdida es una perturbación de cobertura arbórea, no una clasificación automática de deforestación.",
            "Puede incluir cosecha de plantaciones, incendios y perturbaciones naturales.",
            "La serie 2011–2025 fue reprocesada con cambios metodológicos; comparar períodos con cautela.",
            "treecover2000 es cobertura de copa de vegetación de más de 5 m en el año 2000, no cobertura forestal actual.",
        ],
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


@router.post("/gfw-drivers/analyze")
def gfw_drivers_analyze(req: ForestLotRequest):
    """WRI/Google DeepMind dominant drivers COG mirrored publicly on Source Cooperative."""
    geometry = _polygon(req.geometry)
    try:
        values, mask, transform, crs, resolution = _read_single_cog(geometry, GFW_DRIVERS_COG, 1)
        stats, valid = _class_area_stats(values, mask, transform, DRIVER_CLASSES)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el COG público de drivers GFW/WRI: {exc}")
    total_ha = sum(item["area_ha"] for item in stats.values())
    drivers = [
        {"code": code, "driver": DRIVER_CLASSES[code], "pixels": item["pixels"],
         "area_ha": item["area_ha"],
         "share_percent": round(item["area_ha"] * 100 / total_ha, 2) if total_ha else None}
        for code, item in stats.items() if item["pixels"]
    ]
    drivers.sort(key=lambda item: item["area_ha"], reverse=True)
    return {
        "success": True,
        "source": "WRI/Google DeepMind Global Drivers of Forest Loss v1.3 (public COG mirror)",
        "source_url": "https://datasets.wri.org/datasets/dominant-drivers-of-tree-cover-loss-at-1km",
        "mirror_url": GFW_DRIVERS_COG,
        "license": "CC-BY-4.0",
        "period": "2001–2025",
        "resolution": "0.01° (approximately 1 km)",
        "valid_pixels": valid,
        "drivers": drivers,
        "limitations": [
            "Un solo driver dominante por celda para todo el período; no representa secuencia ni causas simultáneas.",
            "No distingue pérdida de bosque natural de cosecha o eliminación de plantaciones.",
            "Hereda las limitaciones de detección del producto Hansen.",
        ],
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


@router.post("/jrc/analyze")
def jrc_analyze(req: ForestLotRequest):
    """JRC Global Forest Cover 2020 v4 baseline, read from public 10 m COG."""
    geometry = _polygon(req.geometry)
    try:
        values, mask, transform, crs, resolution = _read_single_cog(geometry, JRC_COG, 1)
        import numpy as np
        valid_mask = ~mask
        forest_mask = valid_mask & (values == 1)
        nonforest_mask = valid_mask & (values == 0)
        forest_stats, valid = _class_area_stats(values, mask, transform, {0, 1})
        forest_ha = forest_stats[1]["area_ha"]
        nonforest_ha = forest_stats[0]["area_ha"]
        total_ha = forest_ha + nonforest_ha
        forest_pixels = int(np.count_nonzero(forest_mask))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo leer el COG público JRC GFC2020 v4: {exc}")
    return {
        "success": True,
        "source": "European Commission Joint Research Centre Global Forest Cover 2020 v4",
        "source_url": "https://forobs.jrc.ec.europa.eu/GFC/v4",
        "mirror_url": JRC_COG,
        "license": "Uso gratuito; atribución solicitada (JRC).",
        "reference_year": 2020,
        "resolution": "10 m (aproximada en el ecuador; grilla armonizada)",
        "valid_pixels": valid,
        "forest_pixels": forest_pixels,
        "forest_area_ha": forest_ha,
        "nonforest_area_ha": nonforest_ha,
        "forest_share_percent": round(forest_ha * 100 / total_ha, 2) if total_ha else None,
        "limitations": [
            "Es una referencia de cobertura forestal para 2020, no una observación actual.",
            "La definición de bosque sigue el marco FAO usado por JRC; no identifica por sí sola bosque nativo ni plantaciones.",
            "No es un mapa catastral ni una determinación legal de cumplimiento EUDR.",
        ],
        "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
