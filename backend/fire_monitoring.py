"""Independent fire-monitoring API: public NASA FIRMS and NOAA GOES-19 FDCF."""
from fastapi import FastAPI, HTTPException
import csv
import datetime
from email.utils import parsedate_to_datetime
import io
import json
import os
import re
import time
import threading
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from shapely.geometry import Point, shape
from shapely.ops import unary_union

app = FastAPI(title="Agro Consultas - Active Fire Monitoring", version="1.0.0")
CACHE = {"expires": 0.0, "payload": None}
GOES_CACHE = {"expires": 0.0, "payload": None}
FORECAST_CACHE = {}
FORECAST_CACHE_LOCK = threading.Lock()
FORECAST_CACHE_TTL_SECONDS = 15 * 60
FORECAST_CACHE_STALE_SECONDS = 2 * 60 * 60


def _forecast_cache_key(lat, lon):
    # Round to ~100 m to collapse repeated taps in the same small area.
    return f"{round(lat, 3):.3f}:{round(lon, 3):.3f}"


def _get_forecast_cache(key, allow_stale=False):
    now = time.monotonic()
    with FORECAST_CACHE_LOCK:
        entry = FORECAST_CACHE.get(key)
        if not entry:
            return None, False
        if now < entry["expires"]:
            return entry["payload"], False
        if allow_stale and now < entry["stale_expires"]:
            return entry["payload"], True
    return None, False


def _store_forecast_cache(key, payload):
    now = time.monotonic()
    with FORECAST_CACHE_LOCK:
        FORECAST_CACHE[key] = {
            "payload": payload,
            "expires": now + FORECAST_CACHE_TTL_SECONDS,
            "stale_expires": now + FORECAST_CACHE_STALE_SECONDS,
        }

# Bounding box is only a fast prefilter; official Georef provincial geometries
# provide the actual national mask so neighbouring countries are not mislabelled.
ARGENTINA_EXTENT = (-74.0, -56.0, -52.0, -20.0)
ARGENTINA_GEOREF_URL = "https://apis.datos.gob.ar/georef/api/v2.0/provincias.geojson"
ARGENTINA_BOUNDARY_CACHE = {"expires": 0.0, "geometry": None, "status": "unknown"}
ARGENTINA_BOUNDARY_LOCK = threading.Lock()


def _get_argentina_boundary():
    """Load and cache the official Georef province polygons for the national mask."""
    now = time.monotonic()
    if now < ARGENTINA_BOUNDARY_CACHE["expires"]:
        return ARGENTINA_BOUNDARY_CACHE["geometry"]
    with ARGENTINA_BOUNDARY_LOCK:
        now = time.monotonic()
        if now < ARGENTINA_BOUNDARY_CACHE["expires"]:
            return ARGENTINA_BOUNDARY_CACHE["geometry"]
        try:
            request = urllib.request.Request(
                ARGENTINA_GEOREF_URL,
                headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "application/geo+json, application/json"},
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.loads(response.read(12_000_000).decode("utf-8"))
            features = payload.get("features", []) if isinstance(payload, dict) else []
            geometries = [shape(feature["geometry"]) for feature in features
                          if feature.get("geometry") and feature.get("geometry").get("type")]
            if not geometries:
                raise ValueError("Georef no devolvió geometrías provinciales GeoJSON.")
            boundary = unary_union(geometries)
            if boundary.is_empty or not boundary.is_valid:
                raise ValueError("La geometría nacional de Georef está vacía o no es válida.")
            ARGENTINA_BOUNDARY_CACHE.update({
                "expires": now + 86400,
                "geometry": boundary,
                "status": "official_georef_provinces",
            })
            return boundary
        except Exception:
            # Keep the service usable during a Georef outage, but disclose that the
            # fallback is only a bounding rectangle and may include neighbouring areas.
            ARGENTINA_BOUNDARY_CACHE.update({
                "expires": now + 300,
                "geometry": None,
                "status": "bounding_box_fallback",
            })
            return None


def _inside_argentina(lon, lat, boundary=None):
    west, south, east, north = ARGENTINA_EXTENT
    if not (west <= lon <= east and south <= lat <= north):
        return False
    geometry = boundary if boundary is not None else _get_argentina_boundary()
    if geometry is None:
        return True
    return bool(geometry.covers(Point(lon, lat)))
FIRMS = {
    "MODIS": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_America_24h.csv",
    "VIIRS_SNPP": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_24h.csv",
    "VIIRS_NOAA20": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_24h.csv",
    "VIIRS_NOAA21": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_24h.csv",
}


def _number(value):
    try:
        number = float(value)
        return number if np.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _last_modified_freshness(value, now=None, stale_after_hours=36):
    """Classify feed freshness from HTTP Last-Modified without treating unknown as fresh."""
    if not value:
        return {"lastModifiedAgeHours": None, "stale": None, "freshness": "unknown"}
    try:
        modified_at = parsedate_to_datetime(value)
        if modified_at.tzinfo is None:
            modified_at = modified_at.replace(tzinfo=datetime.timezone.utc)
        current = now or datetime.datetime.now(datetime.timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=datetime.timezone.utc)
        age_hours = max(0.0, (current - modified_at).total_seconds() / 3600)
    except (TypeError, ValueError, OverflowError):
        return {"lastModifiedAgeHours": None, "stale": None, "freshness": "unknown"}
    stale = age_hours > stale_after_hours
    return {
        "lastModifiedAgeHours": round(age_hours, 1),
        "stale": stale,
        "freshness": "stale" if stale else "fresh",
    }


def _sample_detection_indices(mask, max_points=2500):
    """Return a deterministic sample across all candidate pixels, avoiding top-left bias."""
    candidates = np.argwhere(np.isin(mask, [10, 11, 30, 31]))
    total = int(len(candidates))
    truncated = total > max_points
    if truncated:
        positions = np.linspace(0, total - 1, num=max_points, dtype=np.int64)
        candidates = candidates[positions]
    return candidates, total, truncated


def _fetch_firms(item):
    name, url = item
    req = urllib.request.Request(url, headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "text/csv"})
    with urllib.request.urlopen(req, timeout=8) as response:
        raw = response.read(15_000_000).decode("utf-8-sig", errors="replace")
        modified = response.headers.get("Last-Modified")
    boundary = _get_argentina_boundary()
    features = []
    for row in csv.DictReader(io.StringIO(raw)):
        lat, lon = _number(row.get("latitude")), _number(row.get("longitude"))
        if lat is None or lon is None or not _inside_argentina(lon, lat, boundary):
            continue
        code = str(row.get("satellite", "")).strip()
        satellite = {"T": "Terra", "A": "Aqua", "N": "Suomi-NPP", "N20": "NOAA-20", "N21": "NOAA-21"}.get(code, code or name)
        date, hhmm = row.get("acq_date"), str(row.get("acq_time", "0")).zfill(4)
        observed = None
        if date:
            try:
                observed = datetime.datetime.strptime(date + hhmm[:4], "%Y-%m-%d%H%M").replace(tzinfo=datetime.timezone.utc).isoformat()
            except ValueError:
                pass
        sensor = "MODIS" if name == "MODIS" else "VIIRS"
        confidence = row.get("confidence")
        features.append({
            "type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "NASA FIRMS", "sensor": sensor, "satellite": satellite, "satelliteCode": code,
                "date": date, "timeUtc": hhmm, "observedAt": observed, "confidence": confidence,
                "confidenceNumeric": _number(confidence), "powerMw": _number(row.get("frp")),
                "brightness": _number(row.get("brightness", row.get("bright_ti4"))),
                "version": row.get("version"), "daynight": row.get("daynight"),
                "sourceFile": url.rsplit("/", 1)[-1],
            }
        })
    freshness = _last_modified_freshness(modified)
    return {
        "name": name,
        "ok": True,
        "count": len(features),
        "lastModified": modified,
        **freshness,
        "features": features,
        "boundaryPrecision": "official_georef_provinces" if boundary is not None else "bounding_box_fallback",
    }


@app.get("/api/fires/national")
def national_fires():
    now = time.monotonic()
    if CACHE["payload"] is not None and now < CACHE["expires"]:
        return CACHE["payload"]
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_fetch_firms, item) for item in FIRMS.items()]
        for future in futures:
            try:
                results.append(future.result(timeout=9))
            except Exception as exc:
                results.append({"name": "NASA FIRMS", "ok": False, "error": str(exc)[:200], "count": 0, "features": []})
    good = [r for r in results if r["ok"]]
    if not good:
        raise HTTPException(status_code=502, detail="NASA FIRMS no respondió con archivos recientes.")
    # Old feeds remain visible in diagnostics but are excluded from the live detections layer.
    features = [f for r in good if r.get("stale") is not True for f in r["features"]]
    features.sort(key=lambda f: (f["properties"].get("observedAt") or "", f["properties"].get("sensor") or ""), reverse=True)
    payload = {
        "type": "FeatureCollection", "features": features,
        "meta": {
            "source": "NASA FIRMS", "coverage": "South America 24h CSV filtered to Argentina official provincial geometry when Georef is available",
            "boundaryPrecision": "official_georef_provinces" if all(r.get("boundaryPrecision") == "official_georef_provinces" for r in good) else "bounding_box_fallback",
            "coverageWarning": None if all(r.get("boundaryPrecision") == "official_georef_provinces" for r in good) else "Georef boundary unavailable for one or more feeds; approximate bounding-box filtering may include neighbouring areas.",
            "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "count": len(features),
            "staleSources": [r["name"] for r in results if r.get("stale") is True],
            "sources": [{k: v for k, v in r.items() if k != "features"} for r in results],
        },
    }
    CACHE["payload"], CACHE["expires"] = payload, now + 180
    return payload


@app.get("/api/fires/goes")
def goes19_fires():
    now = datetime.datetime.now(datetime.timezone.utc)
    if GOES_CACHE["payload"] is not None and time.monotonic() < GOES_CACHE["expires"]:
        return GOES_CACHE["payload"]
    try:
        from netCDF4 import Dataset
        from pyproj import CRS, Transformer
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Dependencias GOES no disponibles: {exc}")
    keys = []
    for offset in range(2):
        hour = now - datetime.timedelta(hours=offset)
        prefix = f"ABI-L2-FDCF/{hour.year}/{hour.timetuple().tm_yday:03d}/{hour.hour:02d}/"
        url = "https://noaa-goes19.s3.amazonaws.com/?" + urllib.parse.urlencode({"list-type": "2", "prefix": prefix})
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Agro-Consultas/1.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                root = ET.fromstring(response.read(2_000_000))
            keys.extend(node.findtext("{*}Key") for node in root.findall(".//{*}Contents")
                        if node.findtext("{*}Key") and "OR_ABI-L2-FDCF-M6_G19_" in node.findtext("{*}Key"))
        except Exception:
            continue
    keys = [k for k in keys if k and k.endswith(".nc")]
    if not keys:
        raise HTTPException(status_code=502, detail="No se encontró una escena reciente de GOES-19 FDCF.")
    key = sorted(keys)[-1]
    try:
        req = urllib.request.Request("https://noaa-goes19.s3.amazonaws.com/" + key, headers={"User-Agent": "Agro-Consultas/1.0"})
        with urllib.request.urlopen(req, timeout=8) as response:
            data = response.read(12_000_000)
        ds = Dataset("goes-memory", mode="r", memory=data)
        proj = ds.variables["goes_imager_projection"]
        height, lon0 = float(proj.perspective_point_height), float(proj.longitude_of_projection_origin)
        geos = CRS.from_proj4(f"+proj=geos +h={height} +lon_0={lon0} +sweep=x +a=6378137 +b=6356752.31414 +units=m +no_defs")
        forward = Transformer.from_crs("EPSG:4326", geos, always_xy=True)
        inverse = Transformer.from_crs(geos, "EPSG:4326", always_xy=True)
        west, south, east, north = ARGENTINA_EXTENT
        argentina_boundary = _get_argentina_boundary()
        corners = [forward.transform(lon, lat) for lon in (west, east) for lat in (south, north)]
        xmin, xmax = min(p[0] for p in corners) / height, max(p[0] for p in corners) / height
        ymin, ymax = min(p[1] for p in corners) / height, max(p[1] for p in corners) / height
        xv, yv = ds.variables["x"][:], ds.variables["y"][:]
        xi = np.flatnonzero((xv >= xmin - .002) & (xv <= xmax + .002))
        yi = np.flatnonzero((yv >= ymin - .002) & (yv <= ymax + .002))
        if not len(xi) or not len(yi):
            ds.close()
            return {"type": "FeatureCollection", "features": [], "meta": {"source": "NOAA GOES-19 ABI L2 FDCF", "count": 0, "file": key}}
        ys, xs = slice(int(yi.min()), int(yi.max()) + 1), slice(int(xi.min()), int(xi.max()) + 1)
        mask = np.ma.filled(ds.variables["Mask"][ys, xs], -99).astype(np.int16)
        indices, total_candidates, truncated = _sample_detection_indices(mask, 2500)
        power, temp, area = ds.variables["Power"][ys, xs], ds.variables["Temp"][ys, xs], ds.variables["Area"][ys, xs]
        stamp = re.search(r"_s(\d{13,14})_", key)
        observed = datetime.datetime.strptime(stamp.group(1)[:13], "%Y%j%H%M%S").replace(tzinfo=datetime.timezone.utc).isoformat() if stamp else None
        labels = {10: "Procesado", 11: "Saturado", 30: "Procesado temporal", 31: "Saturado temporal"}
        features = []
        for row, col in indices:
            lon, lat = inverse.transform(float(xv[int(xi.min()) + int(col)]) * height,
                                         float(yv[int(yi.min()) + int(row)]) * height)
            if not _inside_argentina(float(lon), float(lat), argentina_boundary):
                continue
            code = int(mask[row, col])
            def value(array):
                try:
                    v = float(array[row, col])
                    return v if np.isfinite(v) and v > -900 else None
                except Exception:
                    return None
            features.append({
                "type": "Feature", "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                "properties": {
                    "source": "NOAA GOES-19 ABI FDCF", "sensor": "GOES", "satellite": "GOES-19",
                    "maskCode": code, "category": labels.get(code, "Detección"), "powerMw": value(power),
                    "temperatureK": value(temp), "areaM2": value(area), "observedAt": observed, "productFile": key,
                },
            })
        ds.close()
        payload = {
            "type": "FeatureCollection", "features": features,
            "meta": {
                "source": "NOAA GOES-19 ABI L2 FDCF", "satellite": "GOES-19",
                "product": "Full Disk Fire/Hot Spot Characterization", "observedAt": observed,
                "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "count": len(features),
                "maskClasses": "10/11/30/31 (procesado/saturado y sus clases temporalmente filtradas)", "file": key,
                "totalCandidates": total_candidates, "truncated": truncated,
                "boundaryPrecision": "official_georef_provinces" if argentina_boundary is not None else "bounding_box_fallback",
                "returnedLimit": 2500, "sampling": "evenly spaced across candidate index sequence" if truncated else "all candidates",
            },
        }
        GOES_CACHE["payload"], GOES_CACHE["expires"] = payload, time.monotonic() + 120
        return payload
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo procesar la escena GOES-19: {str(exc)[:200]}")


def _fire_weather_indicator(temp_max, humidity_min, wind_max, precipitation):
    """Indicador meteorológico orientativo; no representa el FWI oficial."""
    checks = {
        "temperature": temp_max is not None and temp_max >= 30,
        "humidity": humidity_min is not None and humidity_min <= 30,
        "wind": wind_max is not None and wind_max >= 20,
        "dryness": precipitation is not None and precipitation <= 1,
    }
    available = sum(value is not None for value in (temp_max, humidity_min, wind_max, precipitation))
    if available == 0:
        return {"score": None, "riskLabel": "No evaluable", "riskClass": "no-evaluable",
                "conditions": checks, "availableConditions": 0, "requiredConditions": 4}
    score = sum(25 for active in checks.values() if active)
    if score >= 75:
        label, risk_class = "Muy alto", "muy-alto"
    elif score >= 50:
        label, risk_class = "Alto", "alto"
    elif score >= 25:
        label, risk_class = "Moderado", "moderado"
    else:
        label, risk_class = "Bajo", "bajo"
    return {"score": score, "riskLabel": label, "riskClass": risk_class, "conditions": checks,
            "availableConditions": available, "requiredConditions": 4}


HISTORY_CACHE = {}
HISTORY_CACHE_LOCK = threading.Lock()
HISTORY_CACHE_MAX_ENTRIES = 64
HISTORY_MAX_DAYS = 31


def _store_history_cache(cache_key, payload, ttl_seconds):
    now = time.monotonic()
    with HISTORY_CACHE_LOCK:
        expired = [key for key, entry in HISTORY_CACHE.items() if now >= entry["expires"]]
        for key in expired:
            HISTORY_CACHE.pop(key, None)
        if cache_key not in HISTORY_CACHE and len(HISTORY_CACHE) >= HISTORY_CACHE_MAX_ENTRIES:
            oldest = min(HISTORY_CACHE, key=lambda key: HISTORY_CACHE[key]["expires"])
            HISTORY_CACHE.pop(oldest, None)
        HISTORY_CACHE[cache_key] = {"payload": payload, "expires": now + ttl_seconds}
HISTORY_SENSOR_FAMILIES = {
    "MODIS": ("MODIS_SP", "MODIS_NRT"),
    "VIIRS_SNPP": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "VIIRS_NOAA20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
    "VIIRS_NOAA21": ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT"),
}
FIRMS_AVAILABILITY_CACHE = {"expires": 0.0, "payload": None}
FIRMS_AVAILABILITY_LOCK = threading.Lock()


def _firms_rejection_message(status_code, detail=""):
    text = str(detail or "").lower()
    if any(term in text for term in ("transaction", "rate limit", "too many", "exceed", "quota")):
        return "NASA indicó que se alcanzó el límite temporal de transacciones (HTTP " + str(status_code) + "). Esperá el reinicio de la ventana y reintentá."
    if any(term in text for term in ("invalid map", "invalid key", "map_key invalid", "map key is invalid")):
        return "NASA indicó que la MAP_KEY no es válida (HTTP " + str(status_code) + ")."
    return "NASA rechazó la solicitud (HTTP " + str(status_code) + "). La respuesta no permite distinguir entre credencial, límite temporal o parámetro/producto rechazado."

def _history_date_chunks(start_date, end_date):
    """Yield Area API requests of at most five consecutive days."""
    current = start_date
    while current <= end_date:
        chunk_end = min(end_date, current + datetime.timedelta(days=4))
        yield current, (chunk_end - current).days + 1
        current = chunk_end + datetime.timedelta(days=1)


def _parse_firms_availability(raw):
    """Accept both NASA's range CSV and its per-date SP/NRT availability schema."""
    availability = {}

    def add_range(product, minimum, maximum, exact_day=False):
        try:
            start = datetime.date.fromisoformat(str(minimum).strip())
            end = datetime.date.fromisoformat(str(maximum).strip())
        except (TypeError, ValueError):
            return
        if start <= end:
            current = availability.get(product)
            if current:
                current["minDate"] = min(current["minDate"], start)
                current["maxDate"] = max(current["maxDate"], end)
                if exact_day and current.get("availableDates") is not None:
                    current["availableDates"].add(start)
            else:
                availability[product] = {
                    "minDate": start, "maxDate": end,
                    "availableDates": {start} if exact_day else None,
                }

    def enabled(value):
        return str(value or "").strip().lower() in {"1", "true", "yes", "y", "si"}

    for row in csv.DictReader(io.StringIO(raw)):
        product = (row.get("data_id") or "").strip()
        if product:
            add_range(product, row.get("min_date"), row.get("max_date"))
            continue

        # Newer API schema: one row per sensor/date with independent SP and NRT flags.
        sensor = (row.get("sensor") or "").strip().upper()
        observed_date = row.get("date")
        if sensor and observed_date:
            family = sensor.removesuffix("_SP").removesuffix("_NRT")
            if family not in {"MODIS", "VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21"}:
                continue
            if enabled(row.get("sp")):
                add_range(family + "_SP", observed_date, observed_date, exact_day=True)
            if enabled(row.get("nrt")):
                add_range(family + "_NRT", observed_date, observed_date, exact_day=True)
            continue

        # Compatibility with rows where the product name is in the sensor column.
        if sensor:
            add_range(sensor, row.get("min_date"), row.get("max_date"))

    if not availability:
        raise ValueError("NASA FIRMS no publicó rangos de disponibilidad reconocibles.")
    return availability

def _fetch_firms_availability(map_key, force=False):
    """Read NASA's authoritative SP/NRT date ranges; cache only valid responses."""
    now = time.monotonic()
    with FIRMS_AVAILABILITY_LOCK:
        cached = FIRMS_AVAILABILITY_CACHE.get("payload")
        if not force and cached is not None and now < FIRMS_AVAILABILITY_CACHE["expires"]:
            return cached
    url = (
        "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/"
        + urllib.parse.quote(map_key, safe="") + "/all"
    )
    request = urllib.request.Request(
        url, headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "text/csv"}
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read(300_000).decode("utf-8-sig", errors="replace")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(500).decode("utf-8", errors="replace").strip()
        except Exception:
            body = ""
        body = body.replace(map_key, "[REDACTED]")
        body = re.sub(r"https?://\\S+", "[URL protegida]", body)[:180]
        if exc.code in (400, 401, 403):
            raise RuntimeError(_firms_rejection_message(exc.code, body)) from exc
        raise RuntimeError("NASA FIRMS disponibilidad HTTP " + str(exc.code) + (": " + body[:100] if body else "")) from exc
    availability = _parse_firms_availability(raw)
    with FIRMS_AVAILABILITY_LOCK:
        FIRMS_AVAILABILITY_CACHE.update({"payload": availability, "expires": now + 600})
    return availability


def _history_source_for_day(family, day, availability):
    """Prefer the stable SP archive; use NRT only when SP does not cover the day."""
    standard, near_real_time = HISTORY_SENSOR_FAMILIES[family]
    for source in (standard, near_real_time):
        bounds = availability.get(source)
        if bounds and bounds["minDate"] <= day <= bounds["maxDate"]:
            available_dates = bounds.get("availableDates")
            if available_dates is None or day in available_dates:
                return source
    return None


def _history_query_plan(start_date, end_date, availability):
    """Build per-sensor requests, respecting each product's published date coverage."""
    tasks, unavailable = [], {}
    for family in HISTORY_SENSOR_FAMILIES:
        day = start_date
        active_source, active_start, active_days = None, None, 0
        while day <= end_date:
            source = _history_source_for_day(family, day, availability)
            if source != active_source or active_days >= 5:
                if active_source:
                    tasks.append((family, active_source, active_start, active_days))
                active_source, active_start, active_days = source, day, 0
            if source:
                active_days += 1
            else:
                unavailable.setdefault(family, []).append(day.isoformat())
            day += datetime.timedelta(days=1)
        if active_source:
            tasks.append((family, active_source, active_start, active_days))
    return tasks, unavailable


def _fetch_firms_history_source(map_key, source, bounds, start_date, end_date):
    west, south, east, north = bounds
    features, errors = [], []
    area = ",".join(str(round(value, 6)) for value in (west, south, east, north))
    for date, day_range in _history_date_chunks(start_date, end_date):
        url = (
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
            + urllib.parse.quote(map_key, safe="")
            + "/" + source + "/" + area + "/" + str(day_range) + "/" + date.isoformat()
        )
        request = urllib.request.Request(
            url, headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "text/csv"}
        )
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read(20_000_000).decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(raw))
            if not reader.fieldnames or not {"latitude", "longitude", "acq_date"}.issubset(set(reader.fieldnames)):
                raise ValueError("NASA no devolvió el esquema CSV esperado.")
            for row in reader:
                lat, lon = _number(row.get("latitude")), _number(row.get("longitude"))
                if lat is None or lon is None:
                    continue
                observed_date = row.get("acq_date")
                try:
                    parsed_date = datetime.date.fromisoformat(observed_date)
                except (TypeError, ValueError):
                    continue
                if not (start_date <= parsed_date <= end_date):
                    continue
                sensor = "MODIS" if source.startswith("MODIS") else "VIIRS"
                hhmm = str(row.get("acq_time", "")).zfill(4)[:4]
                observed_at = None
                try:
                    observed_at = datetime.datetime.strptime(
                        observed_date + hhmm, "%Y-%m-%d%H%M"
                    ).replace(tzinfo=datetime.timezone.utc).isoformat()
                except ValueError:
                    pass
                confidence = row.get("confidence")
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "source": "NASA FIRMS", "sensor": sensor, "product": source,
                        "satellite": row.get("satellite"), "date": observed_date,
                        "timeUtc": hhmm, "observedAt": observed_at,
                        "confidence": confidence, "confidenceNumeric": _number(confidence),
                        "powerMw": _number(row.get("frp")),
                        "brightness": _number(row.get("brightness", row.get("bright_ti4"))),
                        "daynight": row.get("daynight"), "version": row.get("version"),
                    },
                })
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read(500).decode("utf-8", errors="replace").strip()
            except Exception:
                detail = ""
            reason = re.sub(r"https?://\S+", "[URL protegida]", detail)[:120]
            reason = reason.replace(map_key, "[REDACTED]")
            if exc.code in (400, 401, 403):
                reason = _firms_rejection_message(exc.code, reason)
            errors.append(source + " " + date.isoformat() + ": " + reason)
        except Exception as exc:
            errors.append(source + " " + date.isoformat() + ": " + str(exc)[:120])
    return features, errors


FIRMS_STATUS_CACHE = {"expires": 0.0, "payload": None}
FIRMS_STATUS_LOCK = threading.Lock()


@app.get("/api/fires/history/status")
def historical_fires_status():
    """Report server-side key configuration and NASA acceptance without exposing credentials."""
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not map_key:
        return {"configured": False, "valid": False, "message": "FIRMS_MAP_KEY no está configurada en el servidor."}
    now = time.monotonic()
    with FIRMS_STATUS_LOCK:
        cached = FIRMS_STATUS_CACHE.get("payload")
        if cached and now < FIRMS_STATUS_CACHE["expires"]:
            return cached

    status_data, status_error, status_body = None, None, ""
    status_url = "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=" + urllib.parse.quote(map_key, safe="")
    request = urllib.request.Request(status_url, headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status_data = json.loads(response.read(4000).decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        status_error = exc.code
        try:
            status_body = exc.read(500).decode("utf-8", errors="replace").strip()
            status_body = status_body.replace(map_key, "[REDACTED]")
            status_body = re.sub(r"https?://\\S+", "[URL protegida]", status_body)[:180]
        except Exception:
            status_body = ""
    except Exception:
        status_error = "unavailable"

    availability, availability_error = None, None
    try:
        availability = _fetch_firms_availability(map_key, force=True)
    except Exception as exc:
        availability_error = str(exc)[:180]

    if availability is not None:
        valid = True
        message = "NASA FIRMS aceptó la clave y publicó la disponibilidad de productos."
    elif status_error in (400, 401, 403) or availability_error:
        valid = None
        rejection = _firms_rejection_message(status_error, status_body) if status_error in (400, 401, 403) else str(availability_error or "")
        message = (
            rejection if status_error in (400, 401, 403)
            else str(availability_error or "No se pudo consultar la disponibilidad de NASA FIRMS.")
        )
    else:
        valid = None
        message = "NASA no devolvió información suficiente para confirmar la autenticación."

    result = {
        "configured": True, "valid": valid,
        "transactionLimit": status_data.get("transaction_limit") if isinstance(status_data, dict) else None,
        "currentTransactions": status_data.get("current_transactions") if isinstance(status_data, dict) else None,
        "transactionInterval": status_data.get("transaction_interval") if isinstance(status_data, dict) else None,
        "availability": [
            {"product": product, "minDate": bounds["minDate"].isoformat(), "maxDate": bounds["maxDate"].isoformat()}
            for product, bounds in (availability or {}).items()
        ],
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "message": message,
    }
    with FIRMS_STATUS_LOCK:
        FIRMS_STATUS_CACHE.update({"payload": result, "expires": now + (300 if valid is True else 30)})
    return result


@app.post("/api/fires/history")
def historical_fires(payload: dict):
    """Query the NASA FIRMS archive using each sensor's published SP/NRT availability."""
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not map_key:
        raise HTTPException(status_code=503, detail="El histórico NASA FIRMS no está configurado: falta FIRMS_MAP_KEY en el servidor.")

    geometry_data = payload.get("geometry") if isinstance(payload, dict) else None
    if geometry_data and geometry_data.get("type") == "Feature":
        geometry_data = geometry_data.get("geometry")
    if not geometry_data or geometry_data.get("type") not in ("Polygon", "MultiPolygon"):
        raise HTTPException(status_code=400, detail="Seleccioná un lote Polygon o MultiPolygon para consultar el histórico.")
    try:
        geometry = shape(geometry_data)
        if geometry.is_empty or not geometry.is_valid:
            geometry = geometry.buffer(0)
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("Geometría no válida.")
        start_date = datetime.date.fromisoformat(str(payload.get("from", "")))
        end_date = datetime.date.fromisoformat(str(payload.get("to", "")))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Geometría o fechas inválidas: " + str(exc)[:140])
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="La fecha final debe ser igual o posterior a la inicial.")
    if (end_date - start_date).days + 1 > HISTORY_MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Consultá períodos de hasta {HISTORY_MAX_DAYS} días por solicitud.")

    west, south, east, north = geometry.bounds
    geometry_hash = __import__("hashlib").sha256(geometry.wkb).hexdigest()
    cache_key = (geometry_hash, start_date.isoformat(), end_date.isoformat())
    now = time.monotonic()
    with HISTORY_CACHE_LOCK:
        cached = HISTORY_CACHE.get(cache_key)
        if cached and now < cached["expires"]:
            return cached["payload"]

    try:
        availability = _fetch_firms_availability(map_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="No se pudo consultar la disponibilidad del archivo NASA FIRMS. " + str(exc)[:200])

    tasks, unavailable = _history_query_plan(start_date, end_date, availability)
    if not tasks:
        return {
            "type": "FeatureCollection", "features": [],
            "meta": {
                "source": "NASA FIRMS", "from": start_date.isoformat(), "to": end_date.isoformat(),
                "count": 0, "products": [], "errors": [],
                "unavailable": unavailable, "complete": True, "coverageComplete": False,
                "message": "NASA FIRMS no publica datos para el período solicitado en los productos consultados.",
                "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
        }

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(_fetch_firms_history_source, map_key, source, (west, south, east, north), date,
                        date + datetime.timedelta(days=days - 1))
            for _family, source, date, days in tasks
        ]
        for task, future in zip(tasks, futures):
            family, source, date, days = task
            try:
                rows, errors = future.result(timeout=150)
                results.append({"family": family, "source": source, "features": rows, "errors": errors})
            except Exception as exc:
                results.append({"family": family, "source": source, "features": [],
                                "errors": [source + " " + date.isoformat() + ": " + str(exc)[:140]]})

    features, errors = [], []
    successful_products = set()
    for result in results:
        errors.extend(result["errors"])
        if not result["errors"]:
            successful_products.add(result["source"])
        for feature in result["features"]:
            lon, lat = feature["geometry"]["coordinates"]
            if geometry.covers(Point(lon, lat)):
                features.append(feature)
    features.sort(key=lambda item: item["properties"].get("observedAt") or "")
    complete = not errors
    payload_out = {
        "type": "FeatureCollection", "features": features,
        "meta": {
            "source": "NASA FIRMS · archive SP/NRT",
            "from": start_date.isoformat(), "to": end_date.isoformat(),
            "count": len(features), "scope": "detections intersecting selected lot geometry",
            "products": sorted(successful_products), "errors": errors,
            "unavailable": unavailable, "complete": complete, "coverageComplete": not unavailable,
            "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "limitations": [
                "Son detecciones térmicas satelitales, no incendios confirmados ni perímetros quemados.",
                "La selección SP/NRT se basa en los rangos de disponibilidad publicados por NASA FIRMS.",
                "La consulta está limitada a 31 días por solicitud y requiere FIRMS_MAP_KEY.",
            ],
        },
    }
    # Never cache rejected or partial responses: the next request must retry the failed sources.
    if complete and not unavailable:
        recent_cutoff = datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=3)
        ttl = 300 if end_date >= recent_cutoff else 86400
        _store_history_cache(cache_key, payload_out, ttl)
    return payload_out

CONAE_METADATA_CACHE = {}
CONAE_METADATA_CACHE_LOCK = threading.Lock()


@app.get("/api/fires/conae/metadata")
def conae_wms_metadata(kind: str):
    """Proxy CONAE WMS capabilities and expose human-readable layer metadata."""
    services = {
        "burned": "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms",
        "fuel": "https://geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms",
    }
    if kind not in services:
        raise HTTPException(status_code=400, detail="Tipo de producto CONAE inválido. Usá burned o fuel.")
    now = time.monotonic()
    with CONAE_METADATA_CACHE_LOCK:
        cached = CONAE_METADATA_CACHE.get(kind)
        if cached and now < cached["expires"]:
            return cached["payload"]
    url = services[kind] + "?service=WMS&request=GetCapabilities&version=1.1.1"
    request = urllib.request.Request(
        url, headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "application/xml,text/xml"}
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            document = ET.fromstring(response.read(8_000_000))
        layers = []
        for layer in document.findall(".//{*}Layer"):
            name = layer.findtext("{*}Name")
            if not name:
                continue
            legend_url = None
            online = layer.find(".//{*}LegendURL/{*}OnlineResource")
            if online is not None:
                legend_url = online.attrib.get("{http://www.w3.org/1999/xlink}href") or online.attrib.get("href")
            layers.append({
                "name": name,
                "title": layer.findtext("{*}Title") or name,
                "abstract": layer.findtext("{*}Abstract") or "",
                "legend": legend_url,
            })
        if not layers:
            raise ValueError("El documento WMS no publicó capas identificables.")
        payload = {
            "kind": kind,
            "service": services[kind],
            "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "layers": layers,
        }
        with CONAE_METADATA_CACHE_LOCK:
            CONAE_METADATA_CACHE[kind] = {"payload": payload, "expires": now + 3600}
        return payload
    except Exception as exc:
        # Keep the last successful official catalogue response available during
        # temporary upstream outages; disclose its age and stale status.
        with CONAE_METADATA_CACHE_LOCK:
            stale = CONAE_METADATA_CACHE.get(kind)
        if stale and stale.get("payload"):
            payload = json.loads(json.dumps(stale["payload"]))
            payload["stale"] = True
            payload["warning"] = "CONAE no respondió; se muestran los últimos metadatos oficiales almacenados."
            payload["upstreamError"] = str(exc)[:120]
            return payload
        raise HTTPException(status_code=502, detail="No se pudieron consultar los metadatos WMS de CONAE: " + str(exc)[:180])


@app.get("/api/fires/forecast")
def fire_weather_forecast(lat: float, lon: float):
    """Pronóstico de tres días; cachea celdas locales y sirve caché obsoleta ante fallos."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Coordenadas fuera del rango WGS84.")

    cache_key = _forecast_cache_key(lat, lon)
    cached, stale = _get_forecast_cache(cache_key)
    if cached is not None:
        result = json.loads(json.dumps(cached))
        result["meta"]["cached"] = True
        result["meta"]["stale"] = False
        return result

    query_lat, query_lon = (float(value) for value in cache_key.split(":"))
    params = urllib.parse.urlencode({
        "latitude": query_lat,
        "longitude": query_lon,
        "daily": "temperature_2m_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
        "hourly": "relative_humidity_2m",
        "forecast_days": 3,
        "timezone": "auto",
    })
    request = urllib.request.Request(
        "https://api.open-meteo.com/v1/forecast?" + params,
        headers={"User-Agent": "Agro-Consultas/1.0", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read(2_000_000).decode("utf-8"))
        daily = payload.get("daily") or {}
        dates = daily.get("time") or []
        hourly = payload.get("hourly") or {}
        humidity_by_date = {}
        for timestamp, value in zip(hourly.get("time") or [], hourly.get("relative_humidity_2m") or []):
            humidity_value = _number(value)
            if humidity_value is not None:
                humidity_by_date.setdefault(str(timestamp)[:10], []).append(humidity_value)
        days = []
        for index, date in enumerate(dates):
            def at(name):
                values = daily.get(name) or []
                return _number(values[index]) if index < len(values) else None
            temp = at("temperature_2m_max")
            humidity_values = humidity_by_date.get(date) or []
            humidity = min(humidity_values) if humidity_values else None
            wind = at("wind_speed_10m_max")
            rain = at("precipitation_sum")
            gust = at("wind_gusts_10m_max")
            indicator = _fire_weather_indicator(temp, humidity, wind, rain)
            parsed_date = datetime.date.fromisoformat(date)
            days.append({
                "date": date,
                "label": parsed_date.strftime("%d/%m") + " · " + ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][parsed_date.weekday()],
                "temperatureMax": temp,
                "humidityMin": humidity,
                "windMax": wind,
                "gustMax": gust,
                "precipitation": rain,
                **indicator,
            })
        if not days:
            raise ValueError("El proveedor no devolvió días de pronóstico.")
        result = {
            "location": {"latitude": query_lat, "longitude": query_lon, "name": f"{query_lat:.3f}, {query_lon:.3f}"},
            "meta": {
                "source": "Open-Meteo · pronóstico diario",
                "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "method": "Indicador orientativo de cuatro condiciones meteorológicas; no es FWI oficial.",
                "cached": False,
                "stale": False,
                "cacheCellDegrees": 0.001,
            },
            "days": days,
        }
        _store_forecast_cache(cache_key, result)
        return result
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        stale_payload, is_stale = _get_forecast_cache(cache_key, allow_stale=True)
        if stale_payload is not None and is_stale:
            result = json.loads(json.dumps(stale_payload))
            result["meta"]["cached"] = True
            result["meta"]["stale"] = True
            result["meta"]["warning"] = "Open-Meteo no respondió; se muestran datos guardados anteriormente."
            return result
        if exc.code == 429:
            retry_after = (exc.headers or {}).get("Retry-After", "60")
            if not str(retry_after).isdigit():
                retry_after = "60"
            raise HTTPException(
                status_code=429,
                detail="Open-Meteo limitó temporalmente las consultas. Esperá antes de volver a intentar.",
                headers={"Retry-After": str(retry_after)},
            )
        raise HTTPException(status_code=502, detail=f"Open-Meteo respondió con HTTP {exc.code}.")
    except Exception as exc:
        stale_payload, is_stale = _get_forecast_cache(cache_key, allow_stale=True)
        if stale_payload is not None and is_stale:
            result = json.loads(json.dumps(stale_payload))
            result["meta"]["cached"] = True
            result["meta"]["stale"] = True
            result["meta"]["warning"] = "Open-Meteo no respondió; se muestran datos guardados anteriormente."
            return result
        raise HTTPException(status_code=502, detail=f"No se pudo consultar el pronóstico meteorológico: {str(exc)[:180]}")
