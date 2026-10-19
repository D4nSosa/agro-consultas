import pytest
import math
from fastapi.testclient import TestClient
from backend.main import app, calculate_shapely_area
from shapely.geometry import Polygon, shape

client = TestClient(app)

SAMPLE_POLYGON_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [-54.68, -26.85],
        [-54.62, -26.85],
        [-54.62, -26.90],
        [-54.68, -26.90],
        [-54.68, -26.85]
    ]]
}

def test_area_calculation():
    poly = shape(SAMPLE_POLYGON_GEOMETRY)
    area_sq_m = calculate_shapely_area(poly)
    area_ha = area_sq_m / 10000.0
    assert area_ha > 0
    assert 2000 < area_ha < 4000

def test_api_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "stacCatalog" in data

def test_api_sample_lots():
    response = client.get("/api/forest/lots")
    assert response.status_code == 200
    lots = response.json()
    assert isinstance(lots, list)
    assert len(lots) == 0

def test_api_stac_search():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-01-01",
        "endDate": "2024-06-01",
        "maxCloudCover": 30.0
    }
    response = client.post("/api/forest/stac", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "success" in data

def test_api_ndvi_calculation():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "date": "2024-05-15"
    }
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "NDVI" in data["indicator"]
    assert "areaHectares" in data
    assert data["areaHectares"] > 0

def test_api_change_detection():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "dateA": "2024-01-01",
        "dateB": "2024-06-01"
    }
    response = client.post("/api/forest/changes", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "deltaNDVI" in data
    assert "classification" in data
    assert "breakdown" in data

def test_api_full_analysis():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "dateA": "2024-01-01",
        "dateB": "2024-06-01"
    }
    response = client.post("/api/forest/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "stac" in data
    assert "changes" in data

def test_api_sar_radar_calculation():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-01-01",
        "endDate": "2024-06-01"
    }
    response = client.post("/api/forest/sar", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "Radar SAR" in data["indicator"]
    assert "areaHectares" in data
    assert data["status"] in ["REAL", "UNAVAILABLE"]
    if data["status"] == "REAL":
        assert "stats" in data
        assert "vv_mean_dB" in data["stats"]
        assert "vh_mean_dB" in data["stats"]
        assert "vh_vv_ratio_dB" in data["stats"]
        assert "interpretation" in data


def test_api_sar_tries_next_scene_when_first_raster_fails(monkeypatch):
    import json
    import backend.main as forest_backend

    features = [
        {
            "id": "scene-first-fails",
            "properties": {"datetime": "2024-05-20T10:00:00Z", "sat:orbit_state": "ascending"},
            "assets": {"vv": {"href": "https://example.test/first-vv.tif"}, "vh": {"href": "https://example.test/first-vh.tif"}}
        },
        {
            "id": "scene-second-works",
            "properties": {"datetime": "2024-05-18T10:00:00Z", "sat:orbit_state": "descending"},
            "assets": {"vv": {"href": "https://example.test/second-vv.tif"}, "vh": {"href": "https://example.test/second-vh.tif"}}
        }
    ]

    class FakeResponse:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self):
            return json.dumps({"features": features}).encode("utf-8")

    monkeypatch.setattr(forest_backend.urllib.request, "urlopen", lambda *args, **kwargs: FakeResponse())
    calls = []
    def fake_process(vv_url, vh_url, geom):
        calls.append(vv_url)
        if "first" in vv_url:
            return None, "No hay píxeles válidos"
        return {
            "vv_mean_dB": -12.0,
            "vh_mean_dB": -20.0,
            "vh_vv_ratio_dB": -8.0,
            "sampleCount": 10,
            "isPoint": False
        }, None
    monkeypatch.setattr(forest_backend, "process_cog_raster_sar_cropped", fake_process)

    response = client.post("/api/forest/sar", json={
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-01-01",
        "endDate": "2024-06-01"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "REAL"
    assert data["productId"] == "scene-second-works"
    assert calls == [
        "https://example.test/first-vv.tif",
        "https://example.test/second-vv.tif"
    ]


def test_api_sar_rejects_invalid_date_range():
    response = client.post("/api/forest/sar", json={
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-06-01",
        "endDate": "2024-01-01"
    })
    assert response.status_code == 400


def test_api_root_survives_missing_rasterio_native_dependency(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def reject_rasterio(name, *args, **kwargs):
        if name == "rasterio" or name.startswith("rasterio."):
            raise ImportError("simulated missing libexpat.so.1")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_rasterio)
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"


def test_sar_processor_reports_rasterio_import_error(monkeypatch):
    import builtins
    import backend.main as forest_backend
    from shapely.geometry import shape

    real_import = builtins.__import__

    def reject_rasterio(name, *args, **kwargs):
        if name == "rasterio" or name.startswith("rasterio."):
            raise ImportError("simulated missing libexpat.so.1")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_rasterio)
    stats, error = forest_backend.process_cog_raster_sar_cropped(
        "https://example.test/vv.tif",
        "https://example.test/vh.tif",
        shape(SAMPLE_POLYGON_GEOMETRY),
    )
    assert stats is None
    assert "simulated missing libexpat.so.1" in error


def test_api_sar_stac_search_sends_intersects_without_bbox(monkeypatch):
    import json
    import backend.main as forest_backend

    captured = {}

    class FakeResponse:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self):
            return json.dumps({"features": []}).encode("utf-8")

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(forest_backend.urllib.request, "urlopen", fake_urlopen)
    response = client.post("/api/forest/sar", json={
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-01-01",
        "endDate": "2024-06-01"
    })

    assert response.status_code == 200
    assert response.json()["status"] == "UNAVAILABLE"
    assert "intersects" in captured["body"]
    assert "bbox" not in captured["body"]
