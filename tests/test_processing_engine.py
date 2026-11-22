import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
AOI = {"type":"Polygon","coordinates":[[[-68.6,-34.7],[-68.5,-34.7],[-68.5,-34.6],[-68.6,-34.6],[-68.6,-34.7]]]}

def feature(collection="sentinel-1-grd", item_id="S1A_TEST"):
    return {"type":"Feature","id":item_id,"collection":collection,"geometry":AOI,
      "bbox":[-68.6,-34.7,-68.5,-34.6],
      "properties":{"datetime":"2026-11-10T10:12:00Z","platform":"sentinel-1a",
        "sar:instrument_mode":"IW","sar:polarizations":["VV","VH"],
        "sat:orbit_state":"ascending","sat:relative_orbit":18},
      "assets":{"vv":{"href":"https://data.example.test/vv.tif"},
        "vh":{"href":"https://data.example.test/vh.tif"},
        "schema-calibration-vv":{"href":"https://data.example.test/cal-vv.xml"},
        "schema-noise-vv":{"href":"https://data.example.test/noise-vv.xml"}},
      "links":[{"rel":"self","href":"https://catalog.example.test/items/S1A_TEST"}]}

def test_capabilities_lists_allowlisted_global_catalogs():
    response=client.get("/api/engine/capabilities")
    assert response.status_code==200
    assert {p["collection"] for p in response.json()["providers"]}=={"sentinel-1-grd","sentinel-2-l2a","landsat-c2-l2"}
    assert "does not download or process raster pixels" in response.json()["limitations"][0]

def test_scene_discovery_normalizes_all_three_collections(monkeypatch):
    from backend import processing_engine
    calls=[]
    def fake_read(provider, body):
        calls.append((provider["collection"],body))
        return {"type":"FeatureCollection","features":[feature(provider["collection"],provider["collection"]+"_TEST")],"links":[]}
    monkeypatch.setattr(processing_engine,"_read_stac_page",fake_read)
    processing_engine._CACHE.clear()
    response=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-01","endDate":"2026-11-22",
      "collections":["sentinel-1-grd","sentinel-2-l2a","landsat-c2-l2"]})
    assert response.status_code==200
    payload=response.json()
    assert payload["status"]=="OK" and payload["meta"]["sceneCount"]==3
    assert len(calls)==3 and all("intersects" in body and "bbox" not in body for _,body in calls)
    sar=next(s for s in payload["scenes"] if s["collection"]=="sentinel-1-grd")
    assert sar["polarizations"]==["VV","VH"] and sar["mode"]=="IW"
    assert "schema-calibration-vv" in sar["assetKeys"]
    assert sar["coverageStatus"]=="INTERSECTS_AOI"

def test_point_feature_aoi_and_cache(monkeypatch):
    from backend import processing_engine
    calls=[]
    def fake_read(provider,body):
        calls.append(body)
        return {"type":"FeatureCollection","features":[feature()],"links":[]}
    monkeypatch.setattr(processing_engine,"_read_stac_page",fake_read)
    processing_engine._CACHE.clear()
    payload={"geometry":{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-54.6,-27.1]}},
      "startDate":"2026-11-01","endDate":"2026-11-22","collections":["sentinel-1-grd"]}
    first=client.post("/api/engine/scenes",json=payload)
    second=client.post("/api/engine/scenes",json=payload)
    assert first.status_code==second.status_code==200
    assert first.json()["meta"]["cacheHit"] is False
    assert second.json()["meta"]["cacheHit"] is True and len(calls)==1

def test_partial_provider_failure_is_not_reported_as_zero_scenes(monkeypatch):
    from backend import processing_engine
    def fake_read(provider,body):
        if provider["collection"]=="sentinel-2-l2a": raise TimeoutError("catalog timeout")
        return {"type":"FeatureCollection","features":[feature()],"links":[]}
    monkeypatch.setattr(processing_engine,"_read_stac_page",fake_read)
    processing_engine._CACHE.clear()
    response=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-01","endDate":"2026-11-22",
      "collections":["sentinel-1-grd","sentinel-2-l2a"]})
    assert response.status_code==200
    assert response.json()["status"]=="PARTIAL"
    assert response.json()["meta"]["sceneCount"]==1
    assert response.json()["meta"]["errors"][0]["collection"]=="sentinel-2-l2a"

@pytest.mark.parametrize("geometry",[
 {"type":"Point","coordinates":[220,-30]},
 {"type":"LineString","coordinates":[[-54,-27],[-55,-28]]},
 {"type":"Polygon","coordinates":[]},
])
def test_invalid_or_unsupported_geometry_is_rejected(geometry):
    response=client.post("/api/engine/scenes",json={"geometry":geometry,"startDate":"2026-11-01",
      "endDate":"2026-11-22","collections":["sentinel-1-grd"]})
    assert response.status_code==422

def test_unknown_collection_and_reversed_dates_are_rejected():
    unknown=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-01",
      "endDate":"2026-11-22","collections":["arbitrary-url"]})
    reversed_dates=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-22",
      "endDate":"2026-11-01","collections":["sentinel-1-grd"]})
    assert unknown.status_code==422 and reversed_dates.status_code==422
