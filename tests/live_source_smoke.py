#!/usr/bin/env python3
"""Non-blocking live smoke checks for public geospatial catalogs and STAC.

This records service availability; it does not certify dataset coverage or accuracy.
No credentials are read or printed. NASA FIRMS is skipped because MAP_KEY is a
server secret and must never be copied into CI logs.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAC = "https://earth-search.aws.element84.com/v1"
COLLECTIONS = ["sentinel-1-grd", "sentinel-2-l2a", "landsat-c2-l2"]
SAMPLES = [
    "buenos aires", "ciudad autonoma de buenos aires", "catamarca", "chaco",
    "chubut", "cordoba", "corrientes", "entre rios", "formosa", "jujuy",
    "la pampa", "la rioja", "mendoza", "misiones", "neuquen", "rio negro",
    "salta", "san juan", "san luis", "santa cruz", "santa fe",
    "santiago del estero", "tierra del fuego", "tucuman"
]


def request(url: str, payload: dict | None = None, timeout: int = 12):
    headers = {"User-Agent": "Agro-Consultas-National-Source-Smoke/1.0", "Accept": "application/json, application/xml, text/xml"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read(2_000_000)
            return {
                "status": "HTTP_OK" if 200 <= response.status < 300 else "HTTP_ERROR",
                "http_status": response.status,
                "content_type": response.headers.get("Content-Type"),
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                "body": body,
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": "HTTP_ERROR",
            "http_status": exc.code,
            "error": str(exc.reason),
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "body": exc.read(5000),
        }
    except Exception as exc:
        return {
            "status": "UNREACHABLE",
            "http_status": None,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "body": b"",
        }


def request_range(url: str, timeout: int = 20):
    headers = {
        "User-Agent": "Agro-Consultas-National-Source-Smoke/1.0",
        "Range": "bytes=0-1023",
    }
    req = urllib.request.Request(url, headers=headers)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read(1024)
            return {
                "status": "HTTP_OK" if 200 <= response.status < 300 else "HTTP_ERROR",
                "http_status": response.status,
                "content_type": response.headers.get("Content-Type"),
                "content_length": response.headers.get("Content-Length"),
                "content_range": response.headers.get("Content-Range"),
                "range_supported": response.status == 206,
                "first_bytes_hex": body[:16].hex(),
                "looks_like_geotiff": body[:4] in (b"II*\x00", b"MM\x00*"),
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            }
    except urllib.error.HTTPError as exc:
        return {"status": "HTTP_ERROR", "http_status": exc.code, "error": str(exc.reason)}
    except Exception as exc:
        return {"status": "UNREACHABLE", "http_status": None, "error": f"{type(exc).__name__}: {exc}"}
def xml_layer_names(body: bytes):
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    names = []
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] == "Name" and node.text:
            names.append(node.text.strip())
    return names


def check_wms(name: str, endpoint: str, expected: list[str], timeout: int = 12):
    result = request(endpoint + "?service=WMS&version=1.3.0&request=GetCapabilities", timeout=timeout)
    body = result.pop("body", b"")
    names = xml_layer_names(body) if result["status"] == "HTTP_OK" else []
    result["service"] = name
    result["capabilities_layers_count"] = len(names)
    result["expected_layers_found"] = [layer for layer in expected if layer in names]
    result["expected_layers_missing"] = [layer for layer in expected if layer not in names]
    result["layer_names_sample"] = names[:60]
    soil_terms = ("suel", "soil", "edaf", "cartografia", "aptitud", "capacidad_uso")
    result["soil_layer_candidates"] = [
        name for name in names if any(term in name.lower() for term in soil_terms)
    ]
    if result["status"] == "HTTP_OK":
        try:
            root = ET.fromstring(body)
            metadata = []
            soil_metadata = []
            for layer in root.iter():
                if layer.tag.rsplit("}", 1)[-1] != "Layer":
                    continue
                name = next((node.text.strip() for node in layer if node.tag.rsplit("}", 1)[-1] == "Name" and node.text), None)
                if not name:
                    continue
                title = next((node.text for node in layer if node.tag.rsplit("}", 1)[-1] == "Title"), None)
                abstract = next((node.text for node in layer if node.tag.rsplit("}", 1)[-1] == "Abstract"), None)
                crs = []
                for node in layer:
                    if node.tag.rsplit("}", 1)[-1] in ("CRS", "SRS"):
                        crs.extend(value for value in (node.text or "").split() if value)
                boxes = [
                    {"crs": node.attrib.get("CRS") or node.attrib.get("SRS"),
                     "minx": node.attrib.get("minx"), "miny": node.attrib.get("miny"),
                     "maxx": node.attrib.get("maxx"), "maxy": node.attrib.get("maxy")}
                    for node in layer if node.tag.rsplit("}", 1)[-1] == "BoundingBox"
                ]
                styles = []
                for style in layer:
                    if style.tag.rsplit("}", 1)[-1] != "Style":
                        continue
                    style_name = next((node.text for node in style if node.tag.rsplit("}", 1)[-1] == "Name"), None)
                    style_title = next((node.text for node in style if node.tag.rsplit("}", 1)[-1] == "Title"), None)
                    online = next((node for node in style.iter() if node.tag.rsplit("}", 1)[-1] == "OnlineResource"), None)
                    legend_url = None
                    if online is not None:
                        legend_url = online.attrib.get("{http://www.w3.org/1999/xlink}href") or online.attrib.get("href")
                    styles.append({"name": style_name, "title": style_title, "legend_url": legend_url})
                item = {"name": name, "title": title, "abstract": abstract,
                        "queryable": layer.attrib.get("queryable"), "crs": crs,
                        "bounding_boxes": boxes, "styles": styles}
                if ("AQM" in name or "INC_SIART" in name or "DSS_" in name or "MHS_" in name):
                    metadata.append(item)
                if any(term in name.lower() for term in ("suel", "soil", "edaf", "textur", "ph_")):
                    soil_metadata.append(item)
            result["product_layer_metadata_sample"] = metadata[:30]
            result["soil_layer_metadata"] = soil_metadata[:60]
        except ET.ParseError:
            result["product_layer_metadata_sample"] = []
    return result


def check_wfs(name: str, endpoint: str, expected: list[str]):
    result = request(endpoint + "?service=WFS&version=2.0.0&request=GetCapabilities")
    body = result.pop("body", b"")
    names = xml_layer_names(body) if result["status"] == "HTTP_OK" else []
    result["service"] = name
    result["capabilities_feature_types_count"] = len(names)
    result["expected_layers_found"] = [layer for layer in expected if layer in names]
    result["expected_layers_missing"] = [layer for layer in expected if layer not in names]
    return result





def check_inta_national_soil_sample(province: str, coords: dict):
    endpoint = "https://geo-nodo05.inta.gob.ar/geoserver/wms"
    layers = [
        "geonode:ph_0_30_nuevo_recorte_m_4d4cbbd459875375ae3e856e2870841f",
        "geonode:ph_30_100_nuevo_recorte_m_cbccd7b512bb4f943ad9672e961bee3d",
        "geonode:suelos_salinos_0_30_recorte_9622e0e127b7ae1d157c7f49d41605f3",
        "geonode:suelos_salinos_30_100_recorte_437dcf998c66ee96455f4cb196eda5b1",
    ]
    layer_list = ",".join(layers)
    params = urllib.parse.urlencode({
        "service": "WMS",
        "version": "1.1.1",
        "request": "GetFeatureInfo",
        "layers": layer_list,
        "query_layers": layer_list,
        "styles": "",
        "srs": "EPSG:4326",
        "bbox": f"{coords['lng'] - 0.01},{coords['lat'] - 0.01},{coords['lng'] + 0.01},{coords['lat'] + 0.01}",
        "width": "101",
        "height": "101",
        "x": "50",
        "y": "50",
        "format": "image/png",
        "info_format": "application/json",
        "feature_count": "10",
    })
    result = request(endpoint + "?" + params, timeout=20)
    body = result.pop("body", b"")
    result["province_sample"] = province
    result["layers_queried"] = layers
    if result["status"] == "HTTP_OK":
        try:
            data = json.loads(body.decode("utf-8"))
            features = data.get("features", [])
            result["features_returned"] = len(features)
            result["feature_properties"] = [
                {"id": feature.get("id"), "properties": feature.get("properties", {})}
                for feature in features[:10]
            ]
        except Exception:
            result["status"] = "NON_JSON_RESPONSE"
            result["response_preview"] = body[:500].decode("utf-8", errors="replace")
    return result


def check_wms_feature_info(province: str, coords: dict):
    endpoint = "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms"
    layer = "EmergenciasCONAE:MODIS_AQM_1"
    params = urllib.parse.urlencode({
        "service": "WMS",
        "version": "1.1.1",
        "request": "GetFeatureInfo",
        "layers": layer,
        "query_layers": layer,
        "styles": "",
        "srs": "EPSG:4326",
        "bbox": f"{coords['lng'] - 0.01},{coords['lat'] - 0.01},{coords['lng'] + 0.01},{coords['lat'] + 0.01}",
        "width": "101",
        "height": "101",
        "x": "50",
        "y": "50",
        "format": "image/png",
        "info_format": "application/json",
        "feature_count": "1",
    })
    result = request(endpoint + "?" + params, timeout=20)
    body = result.pop("body", b"")
    result["province_sample"] = province
    result["layer"] = layer
    if result["status"] == "HTTP_OK":
        try:
            data = json.loads(body.decode("utf-8"))
            features = data.get("features", [])
            result["features_returned"] = len(features)
            result["sample_properties"] = features[0].get("properties", {}) if features else None
            result["value_available"] = bool(features)
        except Exception:
            result["status"] = "NON_JSON_RESPONSE"
            result["response_preview"] = body[:500].decode("utf-8", errors="replace")
    return result


def check_wms_layer_render(name: str, endpoint: str, layer_name: str):
    params = urllib.parse.urlencode({
        "service": "WMS",
        "version": "1.1.1",
        "request": "GetMap",
        "layers": layer_name,
        "styles": "",
        "format": "image/png",
        "transparent": "true",
        "srs": "EPSG:4326",
        "bbox": "-75,-56,-53,-21",
        "width": "128",
        "height": "128",
    })
    result = request(endpoint + "?" + params, timeout=20)
    body = result.pop("body", b"")
    content_type = (result.get("content_type") or "").lower()
    result["layer_name"] = layer_name
    result["service"] = name
    result["png_signature_valid"] = body[:8] == b"\x89PNG\r\n\x1a\n"
    if result["status"] == "HTTP_OK" and "image/png" not in content_type:
        result["status"] = "INVALID_LAYER_RESPONSE"
        result["response_preview"] = body[:300].decode("utf-8", errors="replace")
    return result


def check_stac_point(province: str, coords: dict):
    collection_results = {}
    for collection in COLLECTIONS:
        payload = {
            "collections": [collection],
            "intersects": {"type": "Point", "coordinates": [coords["lng"], coords["lat"]]},
            "datetime": "2025-01-01T00:00:00Z/2025-12-31T23:59:59Z",
            "limit": 1,
        }
        result = request(STAC + "/search", payload, timeout=20)
        body = result.pop("body", b"")
        if result["status"] == "HTTP_OK":
            try:
                data = json.loads(body.decode("utf-8"))
                features = data.get("features", [])
                result["items_returned"] = len(features)
                result["sample_item_ids"] = [feature.get("id") for feature in features[:1]]
                sample_metadata = []
                for feature in features[:1]:
                    props = feature.get("properties", {})
                    asset_keys = ("red", "nir", "nir08", "scl", "qa_pixel", "cloud_qa", "vv", "vh")
                    assets = feature.get("assets", {})
                    sample_metadata.append({
                        "collection": feature.get("collection"),
                        "properties": {
                            key: props.get(key) for key in (
                                "datetime", "platform", "eo:cloud_cover",
                                "landsat:cloud_cover_land", "landsat:cloud_cover",
                                "landsat:wrs_path", "landsat:wrs_row"
                            ) if props.get(key) is not None
                        },
                        "assets": {
                            key: {
                                "present": key in assets,
                                "type": assets.get(key, {}).get("type"),
                                "roles": assets.get(key, {}).get("roles"),
                                "raster_bands": assets.get(key, {}).get("raster:bands")
                            } for key in asset_keys if key in assets
                        }
                    })
                result["sample_item_metadata"] = sample_metadata
            except Exception as exc:
                result["status"] = "INVALID_RESPONSE"
                result["error"] = f"{type(exc).__name__}: {exc}"
                result["items_returned"] = 0
        else:
            result["items_returned"] = 0
        collection_results[collection] = result

    found = [name for name, result in collection_results.items()
             if result.get("status") == "HTTP_OK" and result.get("items_returned", 0) > 0]
    statuses = [result.get("status") for result in collection_results.values()]
    return {
        "province_sample": province,
        "sample_kind": "provincial centroid from data/provincias.json",
        "status": "HTTP_OK" if all(status == "HTTP_OK" for status in statuses) else "PARTIAL",
        "collections_with_items": found,
        "collections_without_items_at_this_point": [name for name in COLLECTIONS if name not in found],
        "collection_queries": collection_results,
    }

def main():
    provinces = json.loads((ROOT / "data/provincias.json").read_text(encoding="utf-8"))
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "Smoke test of public service endpoints and sample STAC queries; not a national coverage certification.",
        "national_admin_catalog": {"province_profiles": len(provinces), "expected_profiles": 24, "matches_expected": len(provinces) == 24},
        "checks": {},
        "limitations": [
            "A centroid query is a point sample, not a full-province coverage test.",
            "An empty STAC result at a centroid does not prove that a collection lacks coverage elsewhere in that province.",
            "GetCapabilities proves service metadata availability, not that every layer returns valid data for a lot.",
            "NASA FIRMS is skipped because its MAP_KEY must remain a protected server secret and is not injected into CI."
        ]
    }

    collection_result = request(STAC + "/collections")
    collection_body = collection_result.pop("body", b"")
    if collection_result["status"] == "HTTP_OK":
        try:
            data = json.loads(collection_body.decode("utf-8"))
            available = sorted(item.get("id") for item in data.get("collections", []))
            collection_result["expected_collections_found"] = [c for c in COLLECTIONS if c in available]
            collection_result["expected_collections_missing"] = [c for c in COLLECTIONS if c not in available]
        except Exception as exc:
            collection_result["status"] = "INVALID_RESPONSE"
            collection_result["error"] = f"{type(exc).__name__}: {exc}"
    report["checks"]["earth_search_collections"] = collection_result

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(check_stac_point, province, provinces[province]["coordenadas"])
            for province in SAMPLES
        ]
        report["checks"]["stac_provincial_samples"] = [future.result() for future in futures]

    report["checks"]["conae"] = [
        check_wfs("CONAE focos MODIS/VIIRS", "https://geoservicios.conae.gov.ar/geoserver/FocosDeCalor/wfs",
                  ["GeoServiciosCONAE:FocosDeCalor", "GeoServiciosCONAE:FocosDeCalorVIIRS"]),
        check_wms("CONAE áreas quemadas MODIS AQM", "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms",
                  ["MODIS_AQM_1"]),
        check_wms("CONAE disponibilidad de combustibles", "https://geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms",
                  ["AlertaTemprana:INC_SIARTIVGEOL89_DC_1", "AlertaTemprana:INC_SIARTIVGEOSNPP_DC_1"]),
        check_wms("CONAE SAOCOM humedad", "https://geoservicios3.conae.gov.ar/geoserver/HumedadDeSuelos/wms",
                  ["HumedadDeSuelos:DSS_MSM_1", "HumedadDeSuelos:DSS_MSMKR_1"]),
        check_wms("CONAE cultivos y anomalías de rinde", "https://geoservicios3.conae.gov.ar/geoserver/Cultivos/wms",
                  ["Cultivos:MHS_DSS_ASU_1", "Cultivos:MHS_DSS_NSU_1", "Cultivos:MHS_DSS_AWH_1", "Cultivos:MHS_DSS_NWH_1"])
    ]
    burned_endpoint = "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms"
    report["checks"]["conae_aqm_getmap"] = [
        check_wms_layer_render("CONAE AQM unqualified layer", burned_endpoint, "MODIS_AQM_1"),
        check_wms_layer_render("CONAE AQM qualified layer", burned_endpoint, "EmergenciasCONAE:MODIS_AQM_1"),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(check_wms_feature_info, province, provinces[province]["coordenadas"])
            for province in SAMPLES
        ]
        report["checks"]["conae_aqm_point_samples"] = [future.result() for future in futures]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(check_inta_national_soil_sample, province, provinces[province]["coordenadas"])
            for province in SAMPLES
        ]
        report["checks"]["inta_national_soil_samples"] = [future.result() for future in futures]
    report["checks"]["inta_wms"] = check_wms(
        "INTA GeoNode central",
        "https://geo-backend.inta.gob.ar/geoserver/ows",
        []
    )
    # Fetch legends for the national INTA pH/salinity products so their raw classes can be interpreted.
    legend_layers = [
        "geonode:ph_0_30_nuevo_recorte_m_4d4cbbd459875375ae3e856e2870841f",
        "geonode:ph_30_100_nuevo_recorte_m_cbccd7b512bb4f943ad9672e961bee3d",
        "geonode:suelos_salinos_0_30_recorte_9622e0e127b7ae1d157c7f49d41605f3",
        "geonode:suelos_salinos_30_100_recorte_437dcf998c66ee96455f4cb196eda5b1",
    ]
    report["checks"]["inta_legends"] = []
    for layer_name in legend_layers:
        params = urllib.parse.urlencode({
            "service": "WMS", "version": "1.1.1", "request": "GetLegendGraphic",
            "format": "image/png", "layer": layer_name
        })
        legend_result = request("https://geo-nodo05.inta.gob.ar/geoserver/wms?" + params, timeout=15)
        legend_body = legend_result.pop("body", b"")
        legend_result["layer"] = layer_name
        if legend_result.get("status") == "HTTP_OK" and legend_body[:8] == b"\\x89PNG\\r\\n\\x1a\\n":
            legend_path = ROOT / "artifacts" / f"inta-legend-{len(report['checks']['inta_legends']) + 1}.png"
            legend_path.parent.mkdir(parents=True, exist_ok=True)
            legend_path.write_bytes(legend_body)
            legend_result["artifact_path"] = str(legend_path.relative_to(ROOT))
        else:
            legend_result["response_preview"] = legend_body[:300].decode("utf-8", errors="replace")
        report["checks"]["inta_legends"].append(legend_result)
    report["checks"]["inta_wms_legacy"] = check_wms(
        "INTA endpoint legacy",
        "https://geoserver.inta.gob.ar/geoserver/wms",
        []
    )
    inta_nodes = [
        ("INTA Región Salta-Jujuy", "https://geo-nodo01.inta.gob.ar/geoserver/wms"),
        ("INTA Región Santiago del Estero-Tucumán", "https://geo-nodo02.inta.gob.ar/geoserver/wms"),
        ("INTA Región Entre Ríos", "https://geo-nodo03.inta.gob.ar/geoserver/wms"),
        ("INTA Región Río Negro-Neuquén", "https://geo-nodo04.inta.gob.ar/geoserver/wms"),
        ("INTA Centro de Investigación de Recursos Naturales", "https://geo-nodo05.inta.gob.ar/geoserver/wms"),
        ("INTA Región Santa Cruz-Chubut-Tierra del Fuego", "https://geo-nodo06.inta.gob.ar/geoserver/wms"),
        ("INTA Región Buenos Aires", "https://geo-nodo07.inta.gob.ar/geoserver/wms"),
        ("INTA Región Córdoba", "https://geo-nodo08.inta.gob.ar/geoserver/wms"),
        ("INTA Región Corrientes", "https://geo-nodo09.inta.gob.ar/geoserver/wms"),
        ("INTA Región Santa Fe", "https://geo-nodo10.inta.gob.ar/geoserver/wms"),
        ("INTA Región Catamarca-La Rioja", "https://geo-nodo11.inta.gob.ar/geoserver/wms"),
        ("INTA Región Mendoza-San Juan", "https://geo-nodo12.inta.gob.ar/geoserver/wms"),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(check_wms, name, endpoint, [], 8)
            for name, endpoint in inta_nodes
        ]
        report["checks"]["inta_regional_wms"] = [future.result() for future in futures]
    report["checks"]["idecorr_wms"] = check_wms(
        "IDECorr WMS",
        "https://geoportal.corrientes.gob.ar/geoserver/wms",
        [],
        timeout=8
    )

    portal_urls = {
        "idera_portal": "https://www.idera.gob.ar/index.php/servicios/geoservicios",
        "idecorr_portal": "https://ide.corrientes.gob.ar/articulo/geoservicios",
        "mapbiomas_download_catalog": "https://argentina.mapbiomas.org/descargas/mapas-de-la-coleccion/"
    }
    report["checks"]["catalog_portals"] = {
        name: {k: v for k, v in request(url).items() if k != "body"}
        for name, url in portal_urls.items()
    }
    report["checks"]["idera_service_registry"] = request(
        "https://raw.githubusercontent.com/idera/geoservicios/master/sources.json"
    )
    registry_body = report["checks"]["idera_service_registry"].pop("body", b"")
    if report["checks"]["idera_service_registry"]["status"] == "HTTP_OK":
        try:
            registry = json.loads(registry_body.decode("utf-8"))
            report["checks"]["idera_service_registry"]["provider_groups"] = len(registry)
            report["checks"]["idera_service_registry"]["registered_sources"] = sum(
                len(items) for items in registry.values() if isinstance(items, list)
            )
            report["checks"]["idera_service_registry"]["source_ids"] = sorted({
                item.get("id") for items in registry.values() if isinstance(items, list)
                for item in items if item.get("id")
            })
        except Exception as exc:
            report["checks"]["idera_service_registry"]["status"] = "INVALID_RESPONSE"
            report["checks"]["idera_service_registry"]["error"] = f"{type(exc).__name__}: {exc}"
    report["checks"]["mapbiomas_collection2_2024_geotiff_range"] = request_range(
        "https://storage.googleapis.com/mapbiomas-public/initiatives/argentina/collection-2/coverage/argentina_coverage_2024.tif"
    )
    report["checks"]["mapbiomas_collection3_2025_geotiff_range"] = request_range(
        "https://storage.googleapis.com/mapbiomas-public/initiatives/argentina/collection-3/coverage/argentina_coverage_2025.tif"
    )
    report["checks"]["nasa_firms"] = {
        "status": "SKIPPED",
        "reason": "MAP_KEY is a protected runtime secret and is not exposed to this CI smoke test."
    }

    output = ROOT / "artifacts" / "live-source-smoke.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        rows = [
            "| Servicio / prueba | Estado | Detalle |",
            "|---|---|---|",
            f"| Earth Search STAC collections | {collection_result.get('status')} | Encontradas: {', '.join(collection_result.get('expected_collections_found', [])) or 'sin confirmación'} |",
        ]
        for item in report["checks"]["conae"]:
            rows.append(f"| {item.get('service')} | {item.get('status')} | HTTP {item.get('http_status')}; capas: {item.get('capabilities_layers_count', item.get('capabilities_feature_types_count', 0))} |")
        rows.append(f"| INTA WMS central | {report['checks']['inta_wms'].get('status')} | HTTP {report['checks']['inta_wms'].get('http_status')} |")
        regional = report["checks"]["inta_regional_wms"]
        regional_ok = sum(1 for item in regional if item.get("status") == "HTTP_OK")
        soil_nodes = [item.get("service") for item in regional if item.get("soil_layer_metadata")]
        soil_count = sum(len(item.get("soil_layer_metadata", [])) for item in regional)
        rows.append(f"| INTA nodos regionales WMS | {regional_ok}/{len(regional)} activos | Prueba GetCapabilities |")
        rows.append(f"| Capas INTA candidatas de suelo | {soil_count} en {len(soil_nodes)} nodos | Requieren revisar atributos, escala y geometría |")
        rows.append(f"| IDECorr WMS | {report['checks']['idecorr_wms'].get('status')} | HTTP {report['checks']['idecorr_wms'].get('http_status')} |")
        for item in report["checks"]["conae_aqm_getmap"]:
            rows.append(f"| {item.get('service')} | {item.get('status')} | HTTP {item.get('http_status')}; PNG: {item.get('png_signature_valid')} |")
        aqm_samples = report["checks"]["conae_aqm_point_samples"]
        aqm_ok = sum(1 for item in aqm_samples if item.get("status") == "HTTP_OK")
        aqm_values = sum(1 for item in aqm_samples if item.get("value_available"))
        rows.append(f"| CONAE AQM GetFeatureInfo | {aqm_ok}/24 consultas HTTP OK; {aqm_values} con feature | Muestreo puntual de centroides provinciales; no es estadística de lote |")
        inta_samples = report["checks"]["inta_national_soil_samples"]
        inta_ok = sum(1 for item in inta_samples if item.get("status") == "HTTP_OK")
        inta_values = sum(1 for item in inta_samples if item.get("features_returned", 0) > 0)
        rows.append(f"| INTA pH/salinidad nacional GetFeatureInfo | {inta_ok}/24 consultas HTTP OK; {inta_values} con features | Capas cartográficas puntuales, no medición de campo |")
        for name, item in report["checks"]["catalog_portals"].items():
            rows.append(f"| {name} | {item.get('status')} | HTTP {item.get('http_status')} |")
        idera = report["checks"]["idera_service_registry"]
        rows.append(f"| IDERA source registry | {idera.get('status')} | {idera.get('registered_sources', 'sin parsear')} servicios registrados |")
        for key, label in (("mapbiomas_collection2_2024_geotiff_range", "MapBiomas C2 2024 GeoTIFF"), ("mapbiomas_collection3_2025_geotiff_range", "MapBiomas C3 2025 GeoTIFF")):
            item = report["checks"][key]
            rows.append(f"| {label} | {item.get('status')} | HTTP {item.get('http_status')}; Range: {item.get('range_supported')} |")
        stac_rows = report["checks"]["stac_provincial_samples"]
        ok_points = sum(1 for item in stac_rows if item.get("status") == "HTTP_OK" and item.get("items_returned", 0) > 0)
        rows.append(f"| STAC muestras provinciales | {ok_points}/24 con al menos un ítem | Consulta puntual en centroides; no certifica cobertura provincial completa |")
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n## Smoke test de fuentes públicas\n\n")
            summary.write("\n".join(rows))
            summary.write("\n\nReporte JSON: artifacts/live-source-smoke.json\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Report written to {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
