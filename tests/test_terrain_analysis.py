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


def test_terrain_endpoint_processes_a_real_synthetic_dem_raster(tmp_path, monkeypatch):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    dem_path = tmp_path / "synthetic_dem.tif"
    data = np.tile((100 + np.arange(10, dtype="float32") * 2), (10, 1))
    transform = from_origin(-56.002, -27.998, 1 / 3600, 1 / 3600)
    with rasterio.open(
        dem_path,
        "w",
        driver="GTiff",
        height=10,
        width=10,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
        nodata=-9999,
    ) as dataset:
        dataset.write(data, 1)

    aoi = {
        "type": "Polygon",
        "coordinates": [[
            [-56.0015, -28.0005], [-55.9995, -28.0005],
            [-55.9995, -27.9985], [-56.0015, -27.9985],
            [-56.0015, -28.0005]
        ]]
    }
    monkeypatch.setattr(
        processing_engine,
        "_read_stac_pages",
        lambda *args, **kwargs: ([
            {"assets": {"data": {"href": "s3://copernicus-dem-30m/test.tif"}}}
        ], False, 1),
    )
    monkeypatch.setattr(
        processing_engine,
        "_copernicus_dem_asset_url",
        lambda href: str(dem_path),
    )

    response = client.post("/api/engine/terrain", json={"geometry": aoi})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "REAL"
    assert payload["model"] == "DSM"
    assert payload["resolution"] == 30
    assert payload["elevation"]["sample_count"] >= 9
    assert payload["slope"]["mean_deg"] > 0
    assert sum(item["count"] for item in payload["distribution"]["slope"]) == payload["slope"]["sample_count"]
    assert payload["attribution"].startswith("© DLR")
    assert payload["previews"]["elevation"]["dataUri"].startswith("data:image/png;base64,")
    assert payload["previews"]["slope"]["dataUri"].startswith("data:image/png;base64,")
