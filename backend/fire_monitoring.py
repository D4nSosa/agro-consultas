"""Independent fire-monitoring API: public NASA FIRMS and NOAA GOES-19 FDCF."""
from fastapi import FastAPI, HTTPException
import csv
import datetime
from email.utils import parsedate_to_datetime
import io
import re
import time
import threading
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from shapely.geometry import Point, shape
from shapely.ops import unary_union

app = FastAPI(title="Agro Consultas - Active Fire Monitoring", version="1.0.0")
CACHE = {"expires": 0.0, "payload": None}
GOES_CACHE = {"expires": 0.0, "payload": None}
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


@app.get("/api/fires/forecast")
def fire_weather_forecast(lat: float, lon: float):
    """Pronóstico meteorológico de tres días e indicador orientativo de condiciones favorables al fuego."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=400, detail="Coordenadas fuera del rango WGS84.")
    params = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
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
            payload = __import__("json").loads(response.read(2_000_000).decode("utf-8"))
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
        return {
            "location": {"latitude": lat, "longitude": lon, "name": f"{lat:.3f}, {lon:.3f}"},
            "meta": {
                "source": "Open-Meteo · pronóstico diario",
                "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "method": "Indicador orientativo de cuatro condiciones meteorológicas; no es FWI oficial.",
            },
            "days": days,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo consultar el pronóstico meteorológico: {str(exc)[:180]}")
