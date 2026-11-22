"""Sentinel-1 GRD radiometric calibration using the ESA per-polarisation LUT assets.

This module computes ellipsoid-referenced sigma-nought (sigma0), not terrain-flattened
gamma0 RTC. It applies the product calibration LUT and, when available, the thermal
noise LUT. It deliberately fails closed if the calibration annotation is missing.
"""
from __future__ import annotations

import math
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

import numpy as np


def _xml_child_text(element, name):
    child = element.find(f"{{*}}{name}")
    if child is None:
        child = element.find(name)
    if child is None or child.text is None:
        raise ValueError(f"Falta el elemento XML <{name}> en la LUT Sentinel-1.")
    return child.text.strip()


def _xml_float_array(element, name):
    return np.fromstring(_xml_child_text(element, name), sep=" ", dtype=np.float64)


def parse_calibration_lut(xml_bytes):
    """Parse ESA calibration vectors and return line/pixel grids for sigmaNought."""
    root = ET.fromstring(xml_bytes)
    vectors = root.findall(".//{*}calibrationVector")
    if not vectors:
        raise ValueError("El XML de calibración no contiene calibrationVector.")
    lines = np.asarray([float(_xml_child_text(v, "line")) for v in vectors], dtype=np.float64)
    pixels = _xml_float_array(vectors[0], "pixel")
    rows = []
    for vector in vectors:
        values = _xml_float_array(vector, "sigmaNought")
        if values.shape != pixels.shape:
            raise ValueError("La LUT sigmaNought tiene filas de distinta longitud.")
        rows.append(values)
    values = np.vstack(rows)
    if len(lines) < 2 or len(pixels) < 2 or not np.all(np.isfinite(values)) or np.any(values <= 0):
        raise ValueError("La LUT sigmaNought no tiene una grilla válida.")
    return {"lines": lines, "pixels": pixels, "values": values}


def parse_noise_lut(xml_bytes):
    """Parse both pre-IPF-2.90 and modern Sentinel-1 thermal-noise annotations."""
    root = ET.fromstring(xml_bytes)
    vectors = root.findall(".//{*}noiseRangeVector")
    value_tag = "noiseRangeLut"
    if not vectors:
        vectors = root.findall(".//{*}noiseVector")
        value_tag = "noiseLut"
    if not vectors:
        raise ValueError("El XML no contiene una LUT de ruido Sentinel-1.")
    lines = np.asarray([float(_xml_child_text(v, "line")) for v in vectors], dtype=np.float64)
    pixels = _xml_float_array(vectors[0], "pixel")
    rows = [_xml_float_array(v, value_tag) for v in vectors]
    if any(row.shape != pixels.shape for row in rows):
        raise ValueError("La LUT de ruido Sentinel-1 tiene filas de distinta longitud.")
    blocks = []
    for vector in root.findall(".//{*}noiseAzimuthVector"):
        lut_text = vector.find("{*}noiseAzimuthLut")
        if lut_text is None or not lut_text.text:
            continue
        blocks.append({
            "first_line": float(_xml_child_text(vector, "firstAzimuthLine")),
            "last_line": float(_xml_child_text(vector, "lastAzimuthLine")),
            "first_sample": float(_xml_child_text(vector, "firstRangeSample")),
            "last_sample": float(_xml_child_text(vector, "lastRangeSample")),
            "lines": _xml_float_array(vector, "line"),
            "lut": np.fromstring(lut_text.text, sep=" ", dtype=np.float64),
        })
    return {"lines": lines, "pixels": pixels, "values": np.vstack(rows), "azimuth_blocks": blocks}


def _bilinear_lut(grid, q_line, q_pixel):
    lines, pixels, values = grid["lines"], grid["pixels"], grid["values"]
    li = np.clip(np.searchsorted(lines, q_line) - 1, 0, len(lines) - 2)
    pi = np.clip(np.searchsorted(pixels, q_pixel) - 1, 0, len(pixels) - 2)
    l0, l1 = lines[li], lines[li + 1]
    p0, p1 = pixels[pi], pixels[pi + 1]
    tl = np.clip((q_line - l0) / np.maximum(l1 - l0, 1e-9), 0, 1)
    tp = np.clip((q_pixel - p0) / np.maximum(p1 - p0, 1e-9), 0, 1)
    v00, v01 = values[li, pi], values[li, pi + 1]
    v10, v11 = values[li + 1, pi], values[li + 1, pi + 1]
    return v00 * (1 - tl) * (1 - tp) + v01 * (1 - tl) * tp + v10 * tl * (1 - tp) + v11 * tl * tp


def _noise_values(grid, q_line, q_pixel):
    noise = _bilinear_lut(grid, q_line, q_pixel)
    for block in grid["azimuth_blocks"]:
        selected = (
            (q_line >= block["first_line"]) & (q_line <= block["last_line"])
            & (q_pixel >= block["first_sample"]) & (q_pixel <= block["last_sample"])
        )
        if selected.any():
            noise[selected] *= np.interp(q_line[selected], block["lines"], block["lut"])
    return noise


def _fetch_annotation(href, region="eu-central-1"):
    parsed = urlparse(str(href or ""))
    if parsed.scheme == "s3":
        key = parsed.path.lstrip("/")
        url = f"https://{parsed.netloc}.s3.{region}.amazonaws.com/{key}"
        request = urllib.request.Request(
            url, headers={"User-Agent": "Agro-Consultas/1.0", "x-amz-request-payer": "requester"}
        )
    elif parsed.scheme in ("http", "https"):
        request = urllib.request.Request(href, headers={"User-Agent": "Agro-Consultas/1.0"})
    else:
        raise ValueError("El catálogo no publicó una URL HTTP/S3 válida para la anotación de calibración.")
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read(4_000_000)


def _raster_path(href):
    parsed = urlparse(str(href or ""))
    if parsed.scheme == "s3":
        return f"/vsis3/{parsed.netloc}{parsed.path}"
    return href


def _sample_source_coordinates(gcps, xs, ys):
    from rasterio.transform import GCPTransformer
    with GCPTransformer(gcps, tps=True) as transformer:
        rows, cols = transformer.rowcol(xs, ys, op=lambda value: value)
    return np.asarray(rows, dtype=np.float64), np.asarray(cols, dtype=np.float64)


def _calibrate_array(dn, q_line, q_pixel, calibration, noise):
    amplitude_power = np.asarray(dn, dtype=np.float64) ** 2
    if noise is not None:
        amplitude_power = np.maximum(amplitude_power - _noise_values(noise, q_line, q_pixel), 0.0)
    coefficient = _bilinear_lut(calibration, q_line, q_pixel)
    valid = (
        (np.asarray(dn) > 0) & np.isfinite(amplitude_power)
        & np.isfinite(coefficient) & (coefficient > 0)
    )
    sigma0 = np.full(np.asarray(dn).shape, np.nan, dtype=np.float64)
    sigma0[valid] = amplitude_power[valid] / (coefficient[valid] ** 2)
    valid &= np.isfinite(sigma0) & (sigma0 > 0)
    return sigma0, valid


def _stats(values, prefix):
    valid = values[np.isfinite(values) & (values > 0)]
    if not valid.size:
        raise ValueError(f"No quedaron píxeles {prefix} calibrados válidos.")
    db = 10.0 * np.log10(valid)
    return {
        f"{prefix}_mean_sigma0": round(float(np.mean(valid)), 8),
        f"{prefix}_median_sigma0": round(float(np.median(valid)), 8),
        f"{prefix}_mean_db": round(float(10.0 * np.log10(np.mean(valid))), 3),
        f"{prefix}_median_db": round(float(np.median(db)), 3),
        f"{prefix}_min_db": round(float(np.min(db)), 3),
        f"{prefix}_max_db": round(float(np.max(db)), 3),
        f"{prefix}SampleCount": int(valid.size),
    }


def _process_polarisation(measurement_href, calibration_href, noise_href, geometry, region):
    import rasterio
    from rasterio.mask import mask as rasterio_mask
    from rasterio.vrt import WarpedVRT
    from rasterio.transform import xy
    from shapely.geometry import Point

    calibration = parse_calibration_lut(_fetch_annotation(calibration_href, region))
    noise = None
    noise_warning = None
    if noise_href:
        try:
            noise = parse_noise_lut(_fetch_annotation(noise_href, region))
        except Exception as error:
            noise_warning = f"No se pudo aplicar la corrección de ruido térmico: {str(error)[:160]}"

    env_options = {"AWS_NO_SIGN_REQUEST": "YES", "AWS_REQUEST_PAYER": "requester"}
    with rasterio.Env(**env_options):
        with rasterio.open(_raster_path(measurement_href)) as source:
            gcps, _gcp_crs = source.gcps
            if not gcps:
                raise ValueError("El COG Sentinel-1 no conserva GCP; no se puede vincular la LUT a los píxeles.")
            with WarpedVRT(source, crs="EPSG:4326") as vrt:
                if isinstance(geometry, Point):
                    row, col = vrt.index(geometry.x, geometry.y)
                    if row < 0 or col < 0 or row >= vrt.height or col >= vrt.width:
                        raise ValueError("El punto está fuera de la cobertura de la escena.")
                    dn = np.asarray([[vrt.read(1, window=rasterio.windows.Window(col, row, 1, 1))[0, 0]]], dtype=np.float64)
                    center_x, center_y = vrt.xy(row, col, offset="center")
                    xs, ys = np.asarray([center_x]), np.asarray([center_y])
                else:
                    masked, out_transform = rasterio_mask(vrt, [geometry], crop=True, filled=True, nodata=0)
                    dn = masked[0].astype(np.float64)
                    rows, cols = np.indices(dn.shape)
                    xs, ys = xy(out_transform, rows, cols, offset="center")
                    xs, ys = np.asarray(xs, dtype=np.float64).ravel(), np.asarray(ys, dtype=np.float64).ravel()

            q_line, q_pixel = _sample_source_coordinates(gcps, xs, ys)
            shape = dn.shape
            calibrated, valid = _calibrate_array(dn.ravel(), q_line, q_pixel, calibration, noise)
            calibrated = calibrated.reshape(shape)
            valid = valid.reshape(shape)
            stats = _stats(calibrated, "sigma0")
            stats["sampleCount"] = int(np.count_nonzero(valid))
            stats["noiseRemovalApplied"] = noise is not None
            stats["noiseWarning"] = noise_warning
            return stats


def process_sentinel1_grd(
    vv_href, vh_href, vv_calibration_href, vh_calibration_href,
    vv_noise_href, vh_noise_href, geometry, region="eu-central-1"
):
    """Return calibrated VV/VH sigma0 statistics and provenance, or raise on invalid inputs."""
    vv = _process_polarisation(vv_href, vv_calibration_href, vv_noise_href, geometry, region)
    vh = _process_polarisation(vh_href, vh_calibration_href, vh_noise_href, geometry, region)
    combined = {}
    for key, value in vv.items():
        if key.startswith("sigma0_"):
            combined["vv_" + key.replace("sigma0_", "")] = value
    for key, value in vh.items():
        if key.startswith("sigma0_"):
            combined["vh_" + key.replace("sigma0_", "")] = value
    combined["vvSampleCount"] = vv["sigma0SampleCount"]
    combined["vhSampleCount"] = vh["sigma0SampleCount"]
    combined["sampleCount"] = min(vv["sigma0SampleCount"], vh["sigma0SampleCount"])
    combined["noiseRemovalApplied"] = bool(vv["noiseRemovalApplied"] and vh["noiseRemovalApplied"])
    combined["noiseWarnings"] = [item for item in (vv.get("noiseWarning"), vh.get("noiseWarning")) if item]
    combined["unit"] = "sigma0 linear / dB"
    combined["calibrationStatus"] = "SIGMA0_ELLIPSOID_CALIBRATED"
    return combined
