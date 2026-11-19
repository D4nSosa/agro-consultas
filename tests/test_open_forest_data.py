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
    assert (-70, -30) in origins
    assert (-70, -20) in origins
    assert (-60, -30) in origins
    assert (-60, -20) in origins


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
    values = np.array([[1, 4, 4], [5, 5, 255]], dtype=np.uint8)
    mask = np.array([[False, False, False], [False, False, True]])
    transform = Affine(0.005, 0, -60, 0, -0.005, -29.99)
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
    transform = Affine(0.005, 0, -60, 0, -0.005, -29.99)
    monkeypatch.setattr(
        forest, "_read_single_cog",
        lambda *_args, **_kwargs: (values, mask, transform, "EPSG:4326", (0.005, 0.005)),
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



def test_class_area_stats_weights_partial_pixels_to_lot_intersection():
    from shapely.geometry import box

    values = np.array([[1]], dtype=np.uint8)
    mask = np.array([[False]])
    transform = Affine(0.01, 0, -60, 0, -0.01, -30)
    # A quarter of the pixel footprint, not the full 0.01° cell.
    geometry = box(-60.0, -30.01, -59.995, -30.005)
    stats, valid = forest._class_area_stats(
        values, mask, transform, {1}, geometry, "EPSG:4326"
    )
    full_pixel_area = forest._row_pixel_area_ha(transform, 0)
    assert valid == 1
    assert 0 < stats[1]["area_ha"] < full_pixel_area * 0.30


def test_hansen_tile_origins_support_single_tile_small_lot():
    origins = forest._hansen_tile_origins((-60.10, -30.10, -60.05, -30.05))
    assert origins == [(-70, -30)]


def test_hansen_tile_origins_support_single_tile_northern_hemisphere():
    origins = forest._hansen_tile_origins((-65.10, 10.10, -65.05, 10.05))
    assert origins == [(-70, 10)]
