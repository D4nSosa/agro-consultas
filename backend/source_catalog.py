"""Verified source catalogue and allow-listed OGC discovery for existing Agro-GIS modules.

This is a discovery/metadata adapter, not a claim that every listed dataset is
available for pixel-level analysis. Upstream layers are returned with provenance
and must be selected by the existing Agro, Forestal and Fire consumers.
"""
from __future__ import annotations

import datetime as dt
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/sources", tags=["Source catalogue"])

IDERA_REGISTRY_URL = "https://raw.githubusercontent.com/idera/geoservicios/master/sources.json"
IDECOR_OWS = "https://idecor-ws.mapascordoba.gob.ar/geoserver/ows"
CONAE_SAOCOM_WMS = "https://geoservicios3.conae.gov.ar/geoserver/HumedadDeSuelos/wms"
CONAE_SMAP_WMS = "https://geoservicios2.conae.gov.ar/geoserver/HumedadDeSuelos/wms"
CONAE_FUEL_WMS = "https://geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms"
CONAE_BURNED_WMS = "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms"
CACHE_TTL = 6 * 60 * 60
_cache = {}
_cache_lock = threading.Lock()

# Explicit allow-list: request parameters can never choose an arbitrary host.
OGC_SERVICES = {
    "idecor": {"wms": IDECOR_OWS, "wfs": IDECOR_OWS, "scope": "Córdoba, Argentina"},
    "idecorr": {"wms": "https://geoportal.corrientes.gob.ar/geoserver/wms", "scope": "Corrientes, Argentina"},
    "ign": {"wms": "https://wms.ign.gob.ar/geoserver/ows", "wfs": "https://wms.ign.gob.ar/geoserver/ows", "scope": "Argentina"},
    "inta": {"wms": "https://geo-nodo05.inta.gob.ar/geoserver/wms", "scope": "INTA-CIRN; productos nacionales puntuales y capas del nodo según metadatos"},
    "conae_saocom": {"wms": CONAE_SAOCOM_WMS, "scope": "Productos SAOCOM publicados por CONAE; cobertura según capa"},
    "conae_smap": {"wms": CONAE_SMAP_WMS, "scope": "Humedad superficial SMAP/SMOS; cobertura según capa"},
    "conae_fuel": {"wms": CONAE_FUEL_WMS, "scope": "Productos CONAE de disponibilidad de combustibles; cobertura según capa"},
    "conae_burned": {"wms": CONAE_BURNED_WMS, "scope": "Productos CONAE de áreas quemadas; cobertura según capa"},
}

SOURCE_REFERENCE = {
    "mapbiomas": {
        "id": "mapbiomas_argentina",
        "name": "MapBiomas Argentina",
        "family": "land_cover",
        "status": "REFERENCE_ONLY_AUTH_REQUIRED_FOR_AUTOMATION",
        "collection": "Colección 3",
        "period": "1985-2025",
        "spatialResolutionM": 30,
        "classes": 18,
        "license": "CC BY 4.0",
        "platform": "https://plataforma.argentina.mapbiomas.org/projects/mapbiomas/argentina",
        "downloads": "https://argentina.mapbiomas.org/descargas/mapas-de-la-coleccion/",
        "provincialStatistics": "https://argentina.mapbiomas.org/descargas/estadisticas/",
        "methodology": "https://argentina.mapbiomas.org/iniciativas-y-productos/cobertura-y-uso-del-suelo/cobertura-30m/nueva-pagina/",
        "limitations": [
            "La descarga GeoTIFF directa está temporalmente suspendida según el portal oficial.",
            "La plataforma y los assets de Google Earth Engine requieren sesión/cuenta GEE para exportación automatizada.",
            "No se ejecuta ni se simula una estadística zonal sin acceso autenticado a los assets.",
            "No usar la Colección 2 como si fuera la Colección 3."
        ],
        "citation": "Citar MapBiomas Argentina, Colección 3, y la metodología del producto."
    },
    "idecorr": {
        "id": "idecorr",
        "name": "Infraestructura de Datos Espaciales de Corrientes",
        "family": "regional_territory",
        "status": "OGC_DISCOVERY",
        "wms": "https://geoportal.corrientes.gob.ar/geoserver/wms",
        "scope": "Provincia de Corrientes, Argentina",
        "limitations": ["Fuente provincial complementaria; no representa cobertura nacional."]
    },
    "conae": {
        "id": "conae",
        "name": "Comisión Nacional de Actividades Espaciales",
        "family": "soil_moisture_and_fire",
        "status": "OGC_DISCOVERY",
        "products": [
            {"id": "saocom_profile", "title": "Humedad del perfil de suelo hasta 50 cm", "layers": [f"HumedadDeSuelos:DSS_MSM_{i}" for i in range(1, 8)], "unit": "% volumétrico", "method": "Estimación por zonas homogéneas", "period": "Últimos 7 días", "krigingAlternative": [f"HumedadDeSuelos:DSS_MSMKR_{i}" for i in range(1, 8)]},
            {"id": "saocom_percentile", "title": "Percentiles de humedad del perfil hasta 50 cm", "layers": [f"HumedadDeSuelos:DSS_PSM_{i}" for i in range(1, 8)], "period": "Últimos 7 días", "krigingAlternative": [f"HumedadDeSuelos:DSS_PSMKR_{i}" for i in range(1, 8)]},
            {"id": "smap_surface", "title": "Humedad superficial SMAP", "layers": ["HumedadDeSuelos:SMAP_Pasada_Ascendente", "HumedadDeSuelos:SMAP_Pasada_Descendente"]},
            {"id": "fuel_availability_l89", "title": "Disponibilidad de combustibles L89", "layers": [f"AlertaTemprana:INC_SIARTIVGEOL89_DC_{i}" for i in range(1, 4)], "method": "Desmezclado espectral Landsat 8/9", "components": ["vegetación verde", "vegetación seca/senescente", "suelo descubierto"]},
            {"id": "fuel_availability_snpp", "title": "Disponibilidad de combustibles SNPP", "layers": [f"AlertaTemprana:INC_SIARTIVGEOSNPP_DC_{i}" for i in range(1, 7)], "method": "Desmezclado espectral de producto VIIRS VNP13A1"},
            {"id": "burned_area_aqm", "title": "Áreas quemadas AQM", "service": "https://geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms", "method": "Producto de área quemada; no equivale a foco térmico activo"},
        ],
        "limitations": [
            "La humedad SAOCOM es un promedio estimado por zonas homogéneas hasta 50 cm; no es una medición puntual del lote.",
            "Las capas krigeadas son interpolaciones, no observaciones independientes.",
            "La vigencia diaria y la disponibilidad de cada capa deben confirmarse en GetCapabilities."
        ]
    }
}

def _read_url(url: str, timeout: int = 10, max_bytes: int = 2_000_000) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Agro-Consultas/1.0 (+https://agro-consultas.vercel.app)", "Accept": "application/json, application/xml, text/xml"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ValueError("La respuesta del catálogo supera el tamaño máximo permitido.")
    return body

def _cached(key):
    with _cache_lock:
        item = _cache.get(key)
        if item and time.monotonic() < item["expires"]:
            return item["value"]
    return None

def _store(key, value):
    with _cache_lock:
        _cache[key] = {"value": value, "expires": time.monotonic() + CACHE_TTL}

def _idera_sources():
    cached = _cached("idera")
    if cached is not None:
        return cached, True
    raw = json.loads(_read_url(IDERA_REGISTRY_URL).decode("utf-8"))
    relevant = ("inta", "ign", "indec", "conae", "senasa", "ambiente", "agroindustria", "chaco", "misiones", "corrientes")
    sources = []
    for jurisdiction, entries in raw.items():
        for item in entries if isinstance(entries, list) else []:
            title = str(item.get("title") or item.get("id") or "")
            identifier = str(item.get("id") or "")
            haystack = (title + " " + identifier + " " + jurisdiction).lower()
            if not any(term in haystack for term in relevant):
                continue
            services = {key: item[key] for key in ("wms", "wfs", "wcs", "csw", "catalog", "viewer") if isinstance(item.get(key), str) and item[key].strip()}
            sources.append({
                "id": identifier,
                "name": title,
                "jurisdiction": jurisdiction,
                "services": services,
                "registry": IDERA_REGISTRY_URL,
                "status": "CATALOG_ENTRY_NOT_LIVE_VERIFIED"
            })
    result = {"sources": sources, "registryUpdatedAt": None, "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
    _store("idera", result)
    return result, False

def _parse_capabilities(body: bytes, service: str):
    root = ET.fromstring(body)
    layers = []
    if service == "wms":
        for node in root.findall(".//{*}Layer"):
            name = node.findtext("{*}Name")
            if not name:
                continue
            box = node.find("./{*}EX_GeographicBoundingBox")
            bounds = None
            if box is not None:
                bounds = {}
                for key in ("westBoundLongitude", "southBoundLatitude", "eastBoundLongitude", "northBoundLatitude"):
                    bounds[key] = box.findtext(f"{{*}}{key}")
            layers.append({
                "name": name,
                "title": node.findtext("{*}Title") or name,
                "abstract": node.findtext("{*}Abstract") or None,
                "queryable": node.attrib.get("queryable") in ("1", "true", "TRUE") if "queryable" in node.attrib else None,
                "geographicBounds": bounds,
            })
    elif service == "wfs":
        for node in root.findall(".//{*}FeatureType"):
            name = node.findtext("{*}Name")
            if name:
                layers.append({
                    "name": name,
                    "title": node.findtext("{*}Title") or name,
                    "defaultCRS": node.findtext("{*}DefaultCRS") or node.findtext("{*}SRS") or None,
                    "outputFormats": [x.text for x in node.findall(".//{*}Format") if x.text],
                })
    return layers

@router.get("/catalog")
def get_source_catalog():
    """Returns curated official sources and the current IDERA service registry."""
    try:
        idera, stale = _idera_sources()
        return {
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sources": SOURCE_REFERENCE,
            "idera": {**idera, "cached": stale},
            "disclaimer": "Un registro o GetCapabilities no prueba cobertura efectiva del lote ni disponibilidad de datos para una fecha."
        }
    except Exception as exc:
        cached = _cached("idera")
        return {
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "sources": SOURCE_REFERENCE,
            "idera": {**cached, "cached": True, "warning": str(exc)[:160]} if cached else {
                "sources": [], "cached": False, "status": "UNAVAILABLE", "warning": str(exc)[:160]
            },
            "disclaimer": "Un registro o GetCapabilities no prueba cobertura efectiva del lote ni disponibilidad de datos para una fecha."
        }

@router.get("/ogc/{provider}/{service}")
def get_ogc_capabilities(
    provider: str,
    service: str,
    layer_filter: str | None = Query(default=None, max_length=80)
):
    """Fetch GetCapabilities from a fixed allow-list; never acts as an open proxy."""
    if provider not in OGC_SERVICES or service not in ("wms", "wfs"):
        raise HTTPException(status_code=404, detail="Servicio OGC no registrado.")
    config = OGC_SERVICES[provider]
    endpoint = config.get(service)
    if not endpoint:
        raise HTTPException(status_code=404, detail="El proveedor no publica este tipo de servicio en el registro.")
    key = f"ogc:{provider}:{service}"
    cached = _cached(key)
    if cached is not None:
        payload = dict(cached)
        payload["cacheHit"] = True
    else:
        params = urllib.parse.urlencode({"service": service.upper(), "request": "GetCapabilities", "version": "1.1.1" if service == "wms" else "2.0.0"})
        try:
            body = _read_url(endpoint + "?" + params, timeout=12, max_bytes=8_000_000)
            layers = _parse_capabilities(body, service)
            if not layers:
                raise ValueError("El servicio no publicó capas identificables.")
            payload = {
                "provider": provider,
                "serviceType": service.upper(),
                "endpoint": endpoint,
                "scope": config["scope"],
                "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "layers": layers,
                "status": "LIVE_CAPABILITIES",
                "cacheHit": False
            }
            _store(key, payload)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"No se pudo consultar GetCapabilities de {provider}: {type(exc).__name__}: {str(exc)[:140]}")
    # Direct unit calls receive FastAPI's Query sentinel as the default;
    # HTTP requests receive the validated string value.
    if isinstance(layer_filter, str) and layer_filter:
        needle = layer_filter.casefold()
        payload["layers"] = [item for item in payload["layers"] if needle in (item["name"] + " " + item["title"] + " " + (item.get("abstract") or "")).casefold()]
    return payload
