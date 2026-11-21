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
    assert "requieren sesión/cuenta GEE" in " ".join(mapbiomas["limitations"])
