from fastapi.testclient import TestClient

from backend.main import app
from backend import processing_engine

client = TestClient(app)
AOI = {
    "type": "Polygon",
    "coordinates": [[
        [-56.0, -28.0], [-55.99, -28.0], [-55.99, -27.99],
        [-56.0, -27.99], [-56.0, -28.0]
    ]]
}


def test_terrain_endpoint_reports_missing_dem_tiles_without_zero_values(monkeypatch):
    monkeypatch.setattr(processing_engine, "_read_stac_pages", lambda *args, **kwargs: ([], False, 1))
    response = client.post("/api/engine/terrain", json={"geometry": AOI})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "UNAVAILABLE"
    assert "no devolvió teselas" in payload["message"]
    assert "elevation" not in payload


def test_terrain_endpoint_requires_polygon_geometry():
    response = client.post("/api/engine/terrain", json={
        "geometry": {"type": "Point", "coordinates": [-56.0, -28.0]}
    })
    assert response.status_code == 422


def test_copernicus_dem_asset_url_is_restricted_to_public_bucket():
    assert processing_engine._copernicus_dem_asset_url(
        "s3://copernicus-dem-30m/sample/tile.tif"
    ) == "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/sample/tile.tif"
    try:
        processing_engine._copernicus_dem_asset_url("https://evil.example/data.tif")
    except ValueError as exc:
        assert "bucket público autorizado" in str(exc)
    else:
        raise AssertionError("An external asset URL must be rejected")
