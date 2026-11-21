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


def check_wms(name: str, endpoint: str, expected: list[str]):
    result = request(endpoint + "?service=WMS&version=1.3.0&request=GetCapabilities")
    body = result.pop("body", b"")
    names = xml_layer_names(body) if result["status"] == "HTTP_OK" else []
    result["service"] = name
    result["capabilities_layers_count"] = len(names)
    result["expected_layers_found"] = [layer for layer in expected if layer in names]
    result["expected_layers_missing"] = [layer for layer in expected if layer not in names]
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


def check_stac_point(province: str, coords: dict):
    payload = {
        "collections": COLLECTIONS,
        "intersects": {"type": "Point", "coordinates": [coords["lng"], coords["lat"]]},
        "datetime": "2025-01-01T00:00:00Z/2025-12-31T23:59:59Z",
        "limit": 3,
    }
    result = request(STAC + "/search", payload, timeout=20)
    body = result.pop("body", b"")
    if result["status"] == "HTTP_OK":
        try:
            data = json.loads(body.decode("utf-8"))
            features = data.get("features", [])
            found = sorted({
                feature.get("collection") or feature.get("properties", {}).get("collection")
                for feature in features
                if feature.get("collection") or feature.get("properties", {}).get("collection")
            })
            result["items_returned"] = len(features)
            result["collections_found"] = found
            result["collections_not_returned_in_sample"] = [c for c in COLLECTIONS if c not in found]
        except Exception as exc:
            result["status"] = "INVALID_RESPONSE"
            result["error"] = f"{type(exc).__name__}: {exc}"
    result["province_sample"] = province
    result["sample_kind"] = "provincial centroid from data/provincias.json"
    return result


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
                  ["EmergenciasCONAE:MODIS_AQM_1"]),
        check_wms("CONAE disponibilidad de combustibles", "https://geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms",
                  ["AlertaTemprana:INC_SIARTIVGEOL89_DC_1", "AlertaTemprana:INC_SIARTIVGEOSNPP_DC_1"]),
        check_wms("CONAE SAOCOM humedad", "https://geoservicios3.conae.gov.ar/geoserver/HumedadDeSuelos/wms",
                  ["HumedadDeSuelos:DSS_MSM_1", "HumedadDeSuelos:DSS_MSMKR_1"]),
        check_wms("CONAE cultivos y anomalías de rinde", "https://geoservicios3.conae.gov.ar/geoserver/Cultivos/wms",
                  ["Cultivos:MHS_DSS_ASU_1", "Cultivos:MHS_DSS_NSU_1", "Cultivos:MHS_DSS_AWH_1", "Cultivos:MHS_DSS_NWH_1"])
    ]
    report["checks"]["inta_wms"] = check_wms(
        "INTA cartografía de suelos",
        "https://geoserver.inta.gob.ar/geoserver/wms",
        ["suelos:cartografia_nacional"]
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
        rows.append(f"| INTA WMS | {report['checks']['inta_wms'].get('status')} | HTTP {report['checks']['inta_wms'].get('http_status')} |")
        for name, item in report["checks"]["catalog_portals"].items():
            rows.append(f"| {name} | {item.get('status')} | HTTP {item.get('http_status')} |")
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
