import json

from fastapi.testclient import TestClient

from backend.main import app
from backend import territorial_analysis as territorial

client = TestClient(app)

POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [-60.0, -30.0], [-59.9, -30.0], [-59.9, -29.9],
        [-60.0, -29.9], [-60.0, -30.0]
    ]]
}


def test_gaez_catalog_returns_live_catalog_options_without_credentials(monkeypatch):
    records = [
        {"MAPSET_CODE": "RES05-SUT", "PERIOD": "HP0120", "CLIMATE_DATA_SOURCE": "AgERA5",
         "SSP": "HIST", "CROP": "MAI", "INPUT": "L", "FILE_NAME": "maize"},
        {"MAPSET_CODE": "RES05-SUT", "PERIOD": "HP0120", "CLIMATE_DATA_SOURCE": "AgERA5",
         "SSP": "HIST", "CROP": "WHE", "INPUT": "L", "FILE_NAME": "wheat"},
        {"MAPSET_CODE": "RES05-SUT", "PERIOD": "HP0120", "CLIMATE_DATA_SOURCE": "AgERA5",
         "SSP": "HIST", "CROP": "MAI", "INPUT": "H", "FILE_NAME": "maize-high"},
    ]
    monkeypatch.setattr(territorial, "_gaez_catalog", lambda: records)
    response = client.get("/api/territorial/gaez/catalog?crop=MAI")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["matching_combinations"] == 2
    assert payload["options"]["crops"] == ["MAI"]
    assert payload["options"]["input_levels"] == ["H", "L"]


def test_gaez_rejects_point_geometry():
    response = client.post("/api/territorial/gaez/analyze", json={
        "geometry": {"type": "Point", "coordinates": [-60, -30]},
        "mapset_code": "RES05-SUT", "crop": "MAI", "period": "HP0120",
        "climate_data_source": "AgERA5", "ssp": "HIST", "input_level": "L",
    })
    assert response.status_code == 422


def test_gfw_reports_missing_server_key_without_calling_provider(monkeypatch):
    monkeypatch.delenv("GFW_API_KEY", raising=False)
    response = client.post("/api/territorial/gfw/analyze", json={"geometry": POLYGON})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "GFW_API_KEY_REQUIRED"


def test_gfw_analysis_uses_server_key_and_polygon_geometry(monkeypatch):
    import backend.territorial_analysis as module

    monkeypatch.setenv("GFW_API_KEY", "server-side-test-key")
    monkeypatch.setenv("GFW_API_ORIGIN", "https://agro-consultas.vercel.app")
    module.GFW_CACHE.clear()
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return json.dumps({"data": [{"year": 2022, "area__ha": 1.25}]}).encode()

    def fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["key"] = request.get_header("X-api-key")
        captured["origin"] = request.get_header("Origin")
        captured["body"] = json.loads(request.data.decode())
        return FakeResponse()

    monkeypatch.setattr(module.urllib.request, "urlopen", fake_urlopen)
    response = client.post("/api/territorial/gfw/analyze", json={"geometry": POLYGON})
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["dataset_indicator"] == "umd_tree_cover_loss__year"
    assert captured["url"].endswith("/analysis/zonal")
    assert captured["key"] == "server-side-test-key"
    assert captured["origin"] == "https://agro-consultas.vercel.app"
    assert captured["body"]["sum"] == ["area__ha"]
    assert captured["body"]["group_by"] == ["umd_tree_cover_loss__year"]



def test_gaez_analysis_returns_a_map_overlay_for_the_selected_lot(monkeypatch):
    import numpy as np
    import rasterio
    import rasterio.mask
    from affine import Affine
    from rasterio.crs import CRS

    record = {
        "MAPSET_CODE": "RES05-SUT", "PERIOD": "HP0120",
        "CLIMATE_DATA_SOURCE": "AGERA5", "SSP": "HIST",
        "CROP": "MZE", "INPUT": "L", "FILE_NAME": "maize"
    }
    monkeypatch.setattr(territorial, "_gaez_catalog", lambda: [record])

    class FakeDataset:
        crs = CRS.from_epsg(4326)
        res = (0.01, 0.01)
        nodata = -9999

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(rasterio, "open", lambda *_args, **_kwargs: FakeDataset())
    raster = np.ma.array(
        [[1.0, 2.0], [3.0, 4.0]],
        mask=[[False, False], [False, True]],
    )
    transform = Affine(0.01, 0, -60.0, 0, -0.01, -29.9)
    monkeypatch.setattr(rasterio.mask, "mask", lambda *_args, **_kwargs: (np.ma.array([raster]), transform))

    response = client.post("/api/territorial/gaez/analyze", json={
        "geometry": POLYGON,
        "mapset_code": "RES05-SUT",
        "crop": "MZE",
        "period": "HP0120",
        "climate_data_source": "AGERA5",
        "ssp": "HIST",
        "input_level": "L",
    })

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["map_overlay"]["image_data_url"].startswith("data:image/png;base64,")
    assert len(payload["map_overlay"]["bounds"]) == 2
    assert payload["map_overlay"]["width"] <= 512
    assert payload["map_overlay"]["height"] <= 512
    assert payload["license"].startswith("CC-BY-4.0")
