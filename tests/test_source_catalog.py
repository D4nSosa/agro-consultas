import json

import pytest

from backend import source_catalog as catalog


def test_idera_registry_is_normalized_and_keeps_service_provenance(monkeypatch):
    payload = {
        "Organismos Nacionales": [
            {"id": "ign", "title": "Instituto Geográfico Nacional", "wms": "https://ign.example/wms", "wfs": "https://ign.example/wfs"},
            {"id": "private_misc", "title": "Other", "wms": "https://other.example/wms"}
        ],
        "Corrientes": [
            {"id": "idecorr", "title": "IDE Corrientes", "wms": "https://corrientes.example/wms"}
        ]
    }
    monkeypatch.setattr(catalog, "_read_url", lambda *_args, **_kwargs: json.dumps(payload).encode())
    catalog._cache.clear()

    result, cached = catalog._idera_sources()

    assert cached is False
    assert {item["id"] for item in result["sources"]} == {"ign", "idecorr"}
    ign = next(item for item in result["sources"] if item["id"] == "ign")
    assert ign["services"]["wfs"] == "https://ign.example/wfs"
    assert ign["status"] == "CATALOG_ENTRY_NOT_LIVE_VERIFIED"
    assert ign["registry"] == catalog.IDERA_REGISTRY_URL


def test_wms_capabilities_parser_preserves_published_metadata():
    xml = b"""<?xml version='1.0'?>
    <WMS_Capabilities xmlns='http://www.opengis.net/wms' version='1.3.0'>
      <Capability><Layer><Layer queryable='1'>
        <Name>idecor:soil_sample</Name><Title>Soil sample</Title>
        <Abstract>Published layer abstract</Abstract>
        <EX_GeographicBoundingBox>
          <westBoundLongitude>-65</westBoundLongitude><southBoundLatitude>-34</southBoundLatitude>
          <eastBoundLongitude>-62</eastBoundLongitude><northBoundLatitude>-29</northBoundLatitude>
        </EX_GeographicBoundingBox>
      </Layer></Layer></Capability>
    </WMS_Capabilities>"""
    layers = catalog._parse_capabilities(xml, "wms")

    assert layers == [{
        "name": "idecor:soil_sample",
        "title": "Soil sample",
        "abstract": "Published layer abstract",
        "queryable": True,
        "geographicBounds": {
            "westBoundLongitude": "-65", "southBoundLatitude": "-34",
            "eastBoundLongitude": "-62", "northBoundLatitude": "-29"
        }
    }]


def test_wfs_capabilities_parser_preserves_feature_types():
    xml = b"""<WFS_Capabilities xmlns='http://www.opengis.net/wfs'>
      <FeatureTypeList><FeatureType><Name>idecor:parcel</Name><Title>Parcel</Title>
      <DefaultCRS>urn:ogc:def:crs:EPSG::4326</DefaultCRS>
      <OutputFormats><Format>application/json</Format></OutputFormats>
      </FeatureType></FeatureTypeList></WFS_Capabilities>"""
    layers = catalog._parse_capabilities(xml, "wfs")
    assert layers[0]["name"] == "idecor:parcel"
    assert layers[0]["defaultCRS"] == "urn:ogc:def:crs:EPSG::4326"
    assert layers[0]["outputFormats"] == ["application/json"]


def test_ogc_discovery_is_allow_listed_and_filterable(monkeypatch):
    xml = b"""<WMS_Capabilities xmlns='http://www.opengis.net/wms'>
    <Capability><Layer>
      <Layer><Name>idecor:soil</Name><Title>Soil</Title></Layer>
      <Layer><Name>idecor:roads</Name><Title>Roads</Title></Layer>
    </Layer></Capability></WMS_Capabilities>"""
    monkeypatch.setattr(catalog, "_read_url", lambda *_args, **_kwargs: xml)
    catalog._cache.clear()

    result = catalog.get_ogc_capabilities("idecor", "wms", "soil")
    assert result["status"] == "LIVE_CAPABILITIES"
    assert [layer["name"] for layer in result["layers"]] == ["idecor:soil"]
    assert result["endpoint"] == catalog.IDECOR_OWS
    assert catalog.get_ogc_capabilities("idecor", "wms")["cacheHit"] is True

    with pytest.raises(Exception):
        catalog.get_ogc_capabilities("attacker.example", "wms")


def test_source_reference_discloses_mapbiomas_automation_limitations(monkeypatch):
    monkeypatch.setattr(catalog, "_idera_sources", lambda: ({"sources": [], "retrievedAt": "2026-11-21T00:00:00Z"}, False))
    result = catalog.get_source_catalog()
    mapbiomas = result["sources"]["mapbiomas"]
    assert mapbiomas["period"] == "1985-2025"
    assert mapbiomas["spatialResolutionM"] == 30
    assert mapbiomas["license"] == "CC BY 4.0"
    assert "flujo autorizado de MapBiomas/GEE" in " ".join(mapbiomas["limitations"])


def test_mapbiomas_wms_is_allowlisted_and_restricted_to_argentina_workspace(monkeypatch):
    xml = b"""<WMS_Capabilities xmlns='http://www.opengis.net/wms'>
    <Capability><Layer>
      <Layer><Name>mapbiomas-argentina:regiones_forestales</Name><Title>Regiones forestales</Title></Layer>
      <Layer><Name>mapbiomas-arida:land_cover_and_use_2019</Name><Title>Land cover semiarid</Title></Layer>
    </Layer></Capability></WMS_Capabilities>"""
    monkeypatch.setattr(catalog, "_read_url", lambda *_args, **_kwargs: xml)
    catalog._cache.clear()

    result = catalog.get_ogc_capabilities("mapbiomas", "wms")

    assert result["endpoint"] == "https://shared-geoserver.mapbiomas.org/geoserver/ows"
    assert [layer["name"] for layer in result["layers"]] == ["mapbiomas-argentina:regiones_forestales"]
    assert catalog.SOURCE_REFERENCE["mapbiomas"]["status"] == "ANNUAL_TILE_SERVICE_VERIFIED"


def test_mapbiomas_tile_template_rejects_untrusted_hosts_and_query_strings():
    safe = "https://earthengine.googleapis.com/v1/projects/mapbiomas/maps/abc123/tiles/{z}/{x}/{y}"
    assert catalog._safe_mapbiomas_tile_template(safe) is True
    assert catalog._safe_mapbiomas_tile_template(safe + "?token=secret") is False
    assert catalog._safe_mapbiomas_tile_template(safe.replace("earthengine.googleapis.com", "evil.example")) is False


def test_mapbiomas_annual_tile_endpoint_uses_public_collection_and_cache(monkeypatch):
    calls = []
    years = list(range(1985, 2026))

    def fake_json(url, timeout=20):
        calls.append(url)
        if url.endswith("/projects?type=dashboard"):
            return {"projects": [{"key": "argentina", "active": True}]}
        if "/argentina/themes/subthemes?" in url:
            return {"subthemes": [{
                "key": "cobertura-copia-coverage-123",
                "dataType": "annual",
                "asset": {"years": years, "assetId": "projects/mapbiomas/collection-3/coverage"}
            }]}
        if "/argentina/legends?" in url:
            return {"legends": [{"id": "legend-1", "key": "coverage-default"}]}
        if url.endswith("/argentina/legends/legend-1"):
            return {"legend": {"items": [{"pixelValue": 1}, {"pixelValue": 2}, {"pixelValue": 3}]}}
        if "/argentina/maps/map?" in url:
            return {"url": "https://earthengine.googleapis.com/v1/projects/mapbiomas/maps/abc123/tiles/{z}/{x}/{y}"}
        raise AssertionError(url)

    monkeypatch.setattr(catalog, "_read_json_url", fake_json)
    catalog._cache.clear()

    first = catalog.get_mapbiomas_tiles(2025)
    second = catalog.get_mapbiomas_tiles(2025)

    assert first["status"] == "LIVE_XYZ_TILES"
    assert first["year"] == 2025
    assert first["yearRange"] == {"min": 1985, "max": 2025}
    assert first["spatialResolutionM"] == 30
    assert first["legendClasses"] == 3
    assert first["cacheHit"] is False
    assert second["cacheHit"] is True
    assert len(calls) == 5
