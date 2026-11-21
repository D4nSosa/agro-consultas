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
        assert "vv_mean_dn" in data["stats"]
        assert "vh_mean_dn" in data["stats"]
        assert data["stats"]["unit"] == "DN"
        assert data["calibrationStatus"] == "RAW_DN_UNCALIBRATED"
        assert data["interpretation"]["status"] == "NOT_INFERRED"


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
            "vv_mean_dn": 1250.0,
            "vh_mean_dn": 320.0,
            "vvSampleCount": 10,
            "vhSampleCount": 10,
            "sampleCount": 10,
            "unit": "DN",
            "calibrationStatus": "RAW_DN_UNCALIBRATED",
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



def test_scaled_ndvi_uses_reflectance_scale_and_offset():
    from backend.main import calculate_scaled_ndvi

    # Sentinel-2 example: DN 3000/7000 with scale 0.0001 and offset -0.1.
    value = calculate_scaled_ndvi(3000, 7000, 0.0001, -0.1, 0.0001, -0.1)
    assert value == pytest.approx(0.5)
    # Landsat C2 L2 example: scale 0.0000275 and offset -0.2.
    landsat = calculate_scaled_ndvi(10000, 20000, 0.0000275, -0.2, 0.0000275, -0.2)
    assert landsat == pytest.approx(0.6470588235)


def test_sentinel2_scl_rejects_cloud_shadow_snow_and_nodata():
    from backend.main import is_sentinel2_scl_clear

    for excluded in (0, 1, 3, 8, 9, 10, 11):
        assert is_sentinel2_scl_clear(excluded) is False
    for accepted in (2, 4, 5, 6, 7):
        assert is_sentinel2_scl_clear(accepted) is True


def test_stac_search_uses_exact_geometry_and_preserves_band_radiometry(monkeypatch):
    import json
    import backend.main as forest_backend

    captured = {}
    feature = {
        "id": "sentinel2-calibrated-scene",
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "properties": {
            "datetime": "2025-12-31T14:12:51Z",
            "platform": "sentinel-2c",
            "eo:cloud_cover": 0.01
        },
        "assets": {
            "red": {"href": "https://example.test/red.tif", "raster:bands": [{"scale": 0.0001, "offset": -0.1, "spatial_resolution": 10}]},
            "nir": {"href": "https://example.test/nir.tif", "raster:bands": [{"scale": 0.0001, "offset": -0.1, "spatial_resolution": 10}]},
            "scl": {"href": "https://example.test/scl.tif"}
        }
    }

    class FakeResponse:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self):
            return json.dumps({"features": [feature]}).encode("utf-8")

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(forest_backend.urllib.request, "urlopen", fake_urlopen)
    result = forest_backend.search_stac_catalog(
        forest_backend.STACSearchRequest(
            geometry=SAMPLE_POLYGON_GEOMETRY,
            startDate="2025-12-01",
            endDate="2025-12-31",
            maxCloudCover=30
        )
    )

    assert "intersects" in captured["body"]
    assert "bbox" not in captured["body"]
    assert result["success"] is True
    assert result["bestProduct"]["assets"]["redScale"] == 0.0001
    assert result["bestProduct"]["assets"]["redOffset"] == -0.1
    assert result["bestProduct"]["assets"]["nirScale"] == 0.0001
    assert result["bestProduct"]["assets"]["nirOffset"] == -0.1
    assert result["bestProduct"]["resolution"] == 10



def test_landsat_qa_pixel_clear_mask_excludes_fill_cloud_shadow_and_snow():
    from backend.main import is_landsat_qa_pixel_clear

    assert is_landsat_qa_pixel_clear(0) is True
    assert is_landsat_qa_pixel_clear(1 << 7) is True  # Water flag is retained, not a cloud flag.
    for bit in range(6):
        assert is_landsat_qa_pixel_clear(1 << bit) is False


def test_landsat_stac_search_filters_to_landsat_8_9_and_preserves_calibration(monkeypatch):
    import json
    import backend.main as forest_backend

    captured = {}

    def feature(platform, item_id):
        return {
            "id": item_id,
            "geometry": SAMPLE_POLYGON_GEOMETRY,
            "properties": {
                "datetime": "2025-12-27T14:21:57Z",
                "platform": platform,
                "eo:cloud_cover": 0.0,
                "landsat:collection_category": "T1"
            },
            "assets": {
                "red": {"href": f"https://example.test/{item_id}-red.tif", "raster:bands": [{"scale": 2.75e-5, "offset": -0.2, "spatial_resolution": 30}]},
                "nir08": {"href": f"https://example.test/{item_id}-nir.tif", "raster:bands": [{"scale": 2.75e-5, "offset": -0.2, "spatial_resolution": 30}]},
                "qa_pixel": {"href": f"https://example.test/{item_id}-qa.tif", "raster:bands": [{"nodata": 1, "data_type": "uint16", "spatial_resolution": 30}]}
            }
        }

    class FakeResponse:
        status = 200
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self):
            return json.dumps({
                "features": [
                    feature("landsat-8", "LC08_L2SP_test"),
                    feature("landsat-5", "LT05_L2SP_test")
                ]
            }).encode("utf-8")

    def fake_urlopen(request, timeout=0):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(forest_backend.urllib.request, "urlopen", fake_urlopen)
    result = forest_backend.search_stac_catalog(
        forest_backend.STACSearchRequest(
            geometry=SAMPLE_POLYGON_GEOMETRY,
            startDate="2025-12-01",
            endDate="2025-12-31",
            maxCloudCover=100,
            collection="landsat-c2-l2"
        )
    )

    assert captured["body"]["collections"] == ["landsat-c2-l2"]
    assert "intersects" in captured["body"]
    assert result["success"] is True
    assert result["productsCount"] == 1
    assert result["platformRejectedCount"] == 1
    product = result["bestProduct"]
    assert product["sensor"] == "landsat-8"
    assert product["resolution"] == 30
    assert product["assets"]["redScale"] == 2.75e-5
    assert product["assets"]["redOffset"] == -0.2
    assert product["assets"]["nirScale"] == 2.75e-5
    assert product["assets"]["nirOffset"] == -0.2
    assert product["assets"]["qaPixel"].endswith("-qa.tif")
    assert product["assets"]["qualityMaskAsset"] == "qa_pixel"


def test_api_ndvi_landsat_8_point_uses_qa_pixel_mask():
    from backend.main import calculate_ndvi, NDVIAnalysisRequest

    result = calculate_ndvi(NDVIAnalysisRequest(
        geometry={"type": "Point", "coordinates": [-68.5831, -34.6297]},
        date="2025-12-31",
        collection="landsat-c2-l2"
    ))

    assert result["status"] == "REAL", {"message": result.get("message"), "details": result.get("details"), "attempts": result.get("attempts")}
    assert result["collection"] == "landsat-c2-l2"
    assert result["sensor"] in ("landsat-8", "landsat-9")
    assert result["qualityMaskType"] == "Landsat QA_PIXEL"
    assert result["spatialResolution"] == 30
    assert result["reflectanceScalingApplied"] is True
    assert result["stats"]["qaPixelFilterApplied"] is True



def test_planetary_computer_landsat_assets_are_signed_with_cached_public_sas_token(monkeypatch):
    import json
    import backend.main as forest_backend

    forest_backend.PLANETARY_COMPUTER_SAS_CACHE.update({"token": None, "expires_at": None})
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self, _limit=0):
            return json.dumps({
                "token": "se=2030-01-01T00%3A00%3A00Z&sp=rl&sig=test",
                "msft:expiry": "2030-01-01T00:00:00Z"
            }).encode("utf-8")

    def fake_urlopen(request, timeout=0):
        calls.append(request.full_url)
        return FakeResponse()

    monkeypatch.setattr(forest_backend.urllib.request, "urlopen", fake_urlopen)
    first = forest_backend._sign_planetary_computer_asset(
        "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/test/SR_B4.TIF"
    )
    second = forest_backend._sign_planetary_computer_asset(
        "https://landsateuwest.blob.core.windows.net/landsat-c2/level-2/test/SR_B5.TIF"
    )
    untouched = forest_backend._sign_planetary_computer_asset("https://example.test/other.tif")

    assert first.endswith("?se=2030-01-01T00%3A00%3A00Z&sp=rl&sig=test")
    assert second.endswith("?se=2030-01-01T00%3A00%3A00Z&sp=rl&sig=test")
    assert untouched == "https://example.test/other.tif"
    assert len(calls) == 1
    assert "api/sas/v1/token/landsateuwest/landsat-c2" in calls[0]



def test_temporal_ndvi_comparison_falls_back_to_landsat_without_mixing_sensors(monkeypatch):
    import backend.main as forest_backend

    calls = []

    def fake_calculate_ndvi(req):
        calls.append((req.date, req.collection))
        if req.collection == "sentinel-2-l2a":
            return {"status": "UNAVAILABLE", "message": "No SCL-valid pixels"}
        value = 0.5 if req.date == "2025-01-01" else 0.7
        return {
            "status": "REAL",
            "date": req.date,
            "productId": f"LC09_{req.date}",
            "collection": "landsat-c2-l2",
            "sensor": "landsat-9",
            "spatialResolution": 30,
            "qualityMaskType": "Landsat QA_PIXEL",
            "source": "USGS Landsat / Microsoft Planetary Computer",
            "sourceUrl": "https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2",
            "license": "Public domain (USGS Landsat)",
            "acquiredAt": f"{req.date}T14:00:00Z",
            "limitations": ["NDVI no mide biomasa directamente."],
            "stats": {"mean": value}
        }

    monkeypatch.setattr(forest_backend, "calculate_ndvi", fake_calculate_ndvi)
    result = forest_backend.calculate_change_detection(
        forest_backend.ChangeDetectionRequest(
            geometry=SAMPLE_POLYGON_GEOMETRY,
            dateA="2025-01-01",
            dateB="2025-12-31"
        )
    )

    assert calls == [
        ("2025-01-01", "sentinel-2-l2a"),
        ("2025-12-31", "sentinel-2-l2a"),
        ("2025-01-01", "landsat-c2-l2"),
        ("2025-12-31", "landsat-c2-l2")
    ]
    assert result["status"] == "REAL"
    assert result["collection"] == "landsat-c2-l2"
    assert result["sensor"] == "landsat-9"
    assert result["spatialResolution"] == 30
    assert result["source"] == "USGS Landsat / Microsoft Planetary Computer"
    assert result["deltaNDVI"] == 0.2
    assert result["spatialComparisonAvailable"] is False
    assert "NDVI no mide biomasa directamente." in result["limitations"]

def test_stac_post_route_is_registered_exactly_once():
    matching = [
        route for route in app.routes
        if getattr(route, "path", None) == "/api/forest/stac"
        and "POST" in (getattr(route, "methods", None) or set())
    ]
    assert len(matching) == 1
