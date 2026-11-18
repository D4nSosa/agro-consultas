from affine import Affine
import numpy as np
from fastapi.testclient import TestClient

from backend.main import app
from backend import open_forest_data as forest

client = TestClient(app)

POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [-60.0, -30.0], [-59.99, -30.0], [-59.99, -29.99],
        [-60.0, -29.99], [-60.0, -30.0]
    ]]
}


def test_hansen_tile_codes_match_argentina_naming():
    assert forest._hansen_tile_code(-30, "lat") == "30S"
    assert forest._hansen_tile_code(-60, "lon") == "060W"
    assert forest._hansen_tile_code(40, "lat") == "40N"
    assert forest._hansen_tile_code(80, "lon") == "080E"


def test_hansen_tile_origins_include_both_sides_of_boundary():
    origins = forest._hansen_tile_origins((-60.1, -30.1, -59.9, -29.9))
    assert (-70, -40) in origins
    assert (-70, -30) in origins
    assert (-60, -40) in origins
    assert (-60, -30) in origins


def test_public_forest_endpoints_reject_point_geometry():
    point = {"geometry": {"type": "Point", "coordinates": [-60, -30]}}
    for endpoint in (
        "/api/territorial/forest/hansen/analyze",
        "/api/territorial/forest/gfw-drivers/analyze",
        "/api/territorial/forest/jrc/analyze",
    ):
        response = client.post(endpoint, json=point)
        assert response.status_code == 422


def test_gfw_drivers_returns_open_data_zonal_statistics(monkeypatch):
    values = np.array([[1, 1, 4], [5, 5, 255]], dtype=np.uint8)
    mask = np.array([[False, False, False], [False, False, True]])
    transform = Affine(0.01, 0, -60, 0, -0.01, -30)
    monkeypatch.setattr(
        forest, "_read_single_cog",
        lambda *_args, **_kwargs: (values, mask, transform, "EPSG:4326", (0.01, 0.01)),
    )
    response = client.post("/api/territorial/forest/gfw-drivers/analyze", json={"geometry": POLYGON})
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["period"] == "2001–2025"
    assert {item["code"] for item in payload["drivers"]} == {1, 4, 5}
    assert payload["license"] == "CC-BY-4.0"


def test_jrc_returns_2020_forest_share_without_treating_zero_as_nodata(monkeypatch):
    values = np.array([[1, 0], [1, 0]], dtype=np.uint8)
    mask = np.array([[False, False], [False, False]])
    transform = Affine(1 / 12000, 0, -60, 0, -1 / 12000, -30)
    monkeypatch.setattr(
        forest, "_read_single_cog",
        lambda *_args, **_kwargs: (values, mask, transform, "EPSG:4326", (1 / 12000, 1 / 12000)),
    )
    response = client.post("/api/territorial/forest/jrc/analyze", json={"geometry": POLYGON})
    assert response.status_code == 200
    payload = response.json()
    assert payload["forest_pixels"] == 2
    assert payload["valid_pixels"] == 4
    assert payload["forest_share_percent"] == 50.0


def test_hansen_endpoint_returns_source_period_and_limits(monkeypatch):
    monkeypatch.setattr(forest, "_read_hansen_layer", lambda _geometry, layer: (
        {"loss_by_year": {2024: {"pixels": 2, "area_ha": 0.18}},
         "tree_cover_2000": {"pixel_count": 3, "mean_percent": 65.0,
                             "median_percent": 60.0, "p90_percent": 90.0},
         "valid_pixels": 3, "tiles_read": 1}
    ))
    response = client.post("/api/territorial/forest/hansen/analyze", json={"geometry": POLYGON})
    assert response.status_code == 200
    payload = response.json()
    assert payload["loss_by_year"]["2024"]["area_ha"] == 0.18
    assert payload["tree_cover_2000"]["mean_percent"] == 65.0
    assert any("plantaciones" in item for item in payload["limitations"])
