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
      "assets":{"vv":{"href":"s3://sentinel-s1-l1c/GRD/vv.tif","eo:bands":[{"name":"VV"}],"file:size":2048},
        "vh":{"href":"https://data.example.test/vh.tif","eo:bands":[{"name":"VH"}]},
        "schema-calibration-vv":{"href":"https://data.example.test/cal-vv.xml"},
        "schema-noise-vv":{"href":"https://data.example.test/noise-vv.xml"}},
      "links":[{"rel":"self","href":"https://catalog.example.test/items/S1A_TEST"}]}

def test_capabilities_lists_allowlisted_global_catalogs():
    response=client.get("/api/engine/capabilities")
    assert response.status_code==200
    assert {p["collection"] for p in response.json()["providers"]}=={"sentinel-1-grd","sentinel-2-l2a","landsat-c2-l2"}
    assert "POST /process delegates one exact scene" in response.json()["limitations"][0]

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
    assert sar["assets"]["vv"]["href"].startswith("s3://sentinel-s1-l1c/")
    assert sar["assets"]["vv"]["fileSize"] == 2048
    assert sar["bands"] == ["VV", "VH"]
    assert sar["assetCount"] == 4

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


def test_process_dispatches_exact_sentinel1_scene_to_existing_processor(monkeypatch):
    from backend import main as forest_api

    calls = {}
    def fake_sar(req):
        calls["productId"] = req.productId
        calls["startDate"] = req.startDate
        calls["endDate"] = req.endDate
        return {"status": "REAL", "productId": req.productId, "stats": {"vv_mean_db": -12.3}}

    monkeypatch.setattr(forest_api, "get_sar_analysis", fake_sar)
    response = client.post("/api/engine/process", json={
        "geometry": AOI,
        "collection": "sentinel-1-grd",
        "productId": "S1A_EXACT_SCENE",
        "date": "2026-11-10",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "PROCESSED"
    assert payload["assetAccessVerified"] is True
    assert payload["processor"] == "forest.sar"
    assert calls == {
        "productId": "S1A_EXACT_SCENE",
        "startDate": "2026-11-10",
        "endDate": "2026-11-10",
    }


def test_process_dispatches_optical_scene_to_existing_ndvi_processor(monkeypatch):
    from backend import main as forest_api

    calls = {}
    def fake_ndvi(req):
        calls["productId"] = req.productId
        calls["collection"] = req.collection
        calls["date"] = req.date
        return {"status": "REAL", "productId": req.productId, "stats": {"mean": 0.52}}

    monkeypatch.setattr(forest_api, "calculate_ndvi", fake_ndvi)
    response = client.post("/api/engine/process", json={
        "geometry": {"type": "Feature", "properties": {}, "geometry": AOI},
        "collection": "sentinel-2-l2a",
        "productId": "S2_EXACT_SCENE",
        "date": "2026-11-10",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "PROCESSED"
    assert payload["processor"] == "forest.ndvi"
    assert calls == {
        "productId": "S2_EXACT_SCENE",
        "collection": "sentinel-2-l2a",
        "date": "2026-11-10",
    }


def test_process_rejects_unknown_collection_before_dispatch():
    response = client.post("/api/engine/process", json={
        "geometry": AOI,
        "collection": "arbitrary",
        "productId": "SCENE",
        "date": "2026-11-10",
    })
    assert response.status_code == 422



def test_engine_reads_bounded_stac_pagination(monkeypatch):
    from backend import processing_engine

    pages = [
        {"type": "FeatureCollection", "features": [feature(item_id="PAGE_1")],
         "links": [{"rel": "next", "href": "https://earth-search.aws.element84.com/v1/search?token=page2", "method": "GET"}]},
        {"type": "FeatureCollection", "features": [feature(item_id="PAGE_2")], "links": []},
    ]
    monkeypatch.setattr(processing_engine, "_read_stac_page", lambda _provider, _body: pages[0])
    monkeypatch.setattr(processing_engine, "_read_stac_next_page", lambda _provider, _link: pages[1])
    found, has_more, page_count = processing_engine._read_stac_pages(
        processing_engine.PROVIDERS["sentinel-1-grd"], {"collections": ["sentinel-1-grd"]}, max_pages=5
    )
    assert [item["id"] for item in found] == ["PAGE_1", "PAGE_2"]
    assert has_more is False
    assert page_count == 2



def test_sar_processor_fetches_exact_stac_item_and_validates_date(monkeypatch):
    import json
    from backend import main as forest_api

    item = {
        "type": "Feature",
        "id": "S1A_EXACT_SCENE",
        "collection": "sentinel-1-grd",
        "geometry": AOI,
        "bbox": [-68.6, -34.7, -68.5, -34.6],
        "properties": {
            "datetime": "2026-11-10T10:12:00Z",
            "platform": "sentinel-1a",
            "sar:polarizations": ["VV", "VH"],
            "sar:instrument_mode": "IW",
            "sat:orbit_state": "ascending",
        },
        "assets": {
            "vv": {"href": "s3://sentinel-s1-l1c/GRD/vv.tif"},
            "vh": {"href": "s3://sentinel-s1-l1c/GRD/vh.tif"},
            "schema-calibration-vv": {"href": "s3://sentinel-s1-l1c/GRD/cal-vv.xml"},
            "schema-calibration-vh": {"href": "s3://sentinel-s1-l1c/GRD/cal-vh.xml"},
        },
    }

    class Response:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False
        def read(self, *_args):
            return json.dumps(item).encode("utf-8")

    calls = []
    def fake_urlopen(request, timeout=15):
        calls.append(request.full_url)
        return Response()

    monkeypatch.setattr(forest_api.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(forest_api, "process_sentinel1_grd", lambda *args, **kwargs: {
        "vv_mean_db": -11.2, "vh_mean_db": -18.4,
        "vv_mean_sigma0": 0.075, "vh_mean_sigma0": 0.014,
        "vvSampleCount": 12, "vhSampleCount": 12, "sampleCount": 12,
        "noiseRemovalApplied": False, "noiseWarnings": [],
    })
    response = forest_api.get_sar_analysis(forest_api.SARAnalysisRequest(
        geometry=forest_api.GeoJSONGeometry(type="Polygon", coordinates=AOI["coordinates"]),
        startDate="2026-11-10",
        endDate="2026-11-10",
        productId="S1A_EXACT_SCENE",
    ))
    assert response["status"] == "REAL"
    assert response["productId"] == "S1A_EXACT_SCENE"
    assert calls and "/collections/sentinel-1-grd/items/S1A_EXACT_SCENE" in calls[0]


def test_engine_rejects_pagination_links_to_untrusted_hosts():
    from backend import processing_engine

    with pytest.raises(ValueError, match="fuera del origen"):
        processing_engine._read_stac_next_page(
            processing_engine.PROVIDERS["sentinel-1-grd"],
            {"rel": "next", "href": "https://attacker.example/steal", "method": "GET"},
        )


def test_engine_dispatches_territorial_analysis_without_reimplementing_it(monkeypatch):
    from backend import territorial_analysis

    calls = {}
    def fake_gaez(req):
        calls["geometry"] = req.geometry
        calls["mapset_code"] = req.mapset_code
        return {"success": True, "source": "FAO/IIASA GAEZ v5", "statistics": {"mean": 3.4}}

    monkeypatch.setattr(territorial_analysis, "gaez_analyze", fake_gaez)
    response = client.post("/api/engine/analyze", json={
        "geometry": AOI,
        "processor": "gaez",
        "mapset_code": "GAEZ_TEST",
        "crop": "maize",
        "period": "baseline",
        "climate_data_source": "historical",
        "ssp": "none",
        "input_level": "low",
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "PROCESSED"
    assert payload["processor"] == "gaez"
    assert payload["provenancePreserved"] is True
    assert calls["mapset_code"] == "GAEZ_TEST"


def test_engine_rejects_point_for_zonal_territorial_analysis():
    response = client.post("/api/engine/analyze", json={
        "geometry": {"type": "Point", "coordinates": [-54.6, -27.1]},
        "processor": "hansen",
    })
    assert response.status_code == 422



def test_engine_source_catalog_delegates_to_existing_registry(monkeypatch):
    from backend import source_catalog

    monkeypatch.setattr(source_catalog, "get_source_catalog", lambda: {
        "sources": {"conae": {"status": "OGC_DISCOVERY"}},
        "disclaimer": "Catalog entries do not prove coverage.",
    })
    response = client.get("/api/engine/sources")
    assert response.status_code == 200
    assert response.json()["sources"]["conae"]["status"] == "OGC_DISCOVERY"


def test_engine_ogc_adapter_delegates_to_allowlisted_provider(monkeypatch):
    from backend import source_catalog

    calls = {}
    def fake_capabilities(provider, service, layer_filter=None):
        calls.update({"provider": provider, "service": service, "layer_filter": layer_filter})
        return {"provider": provider, "service": service, "layers": []}

    monkeypatch.setattr(source_catalog, "get_ogc_capabilities", fake_capabilities)
    response = client.get("/api/engine/ogc/conae/wms?layer_filter=soil")
    assert response.status_code == 200
    assert calls == {"provider": "conae", "service": "wms", "layer_filter": "soil"}


def test_unknown_collection_and_reversed_dates_are_rejected():
    unknown=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-01",
      "endDate":"2026-11-22","collections":["arbitrary-url"]})
    reversed_dates=client.post("/api/engine/scenes",json={"geometry":AOI,"startDate":"2026-11-22",
      "endDate":"2026-11-01","collections":["sentinel-1-grd"]})
    assert unknown.status_code==422 and reversed_dates.status_code==422
