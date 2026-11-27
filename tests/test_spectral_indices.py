import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)
AOI = {
    "type": "Polygon",
    "coordinates": [[
        [-56.0, -28.0], [-55.99, -28.0], [-55.99, -27.99],
        [-56.0, -27.99], [-56.0, -28.0]
    ]]
}


def test_spectral_endpoint_returns_calculated_indices_and_scene_metadata(monkeypatch):
    from backend import main as api

    monkeypatch.setattr(api, "search_stac_catalog", lambda req: {
        "products": [{
            "id": "S2_TEST_SCENE",
            "date": "2026-11-20",
            "collection": "sentinel-2-l2a",
            "sensor": "sentinel-2b",
            "source": "Copernicus Sentinel-2 / AWS Earth Search STAC",
            "sourceUrl": "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a",
            "cloudCover": 4.2
        }]
    })
    monkeypatch.setattr(api, "_process_spectral_scene", lambda candidate, geometry, indices: ({
        "indices": {
            "ndvi": {"status": "REAL", "label": "NDVI", "mean": 0.62, "median": 0.61, "sampleCount": 120},
            "ndmi": {"status": "REAL", "label": "NDMI", "mean": 0.21, "median": 0.2, "sampleCount": 120},
            "ndre": {"status": "UNAVAILABLE", "message": "No disponible"}
        },
        "qualityMask": "SCL",
        "resolution": 20,
        "resolutionUnit": "m",
        "gridShape": [12, 10],
        "referenceCrs": "EPSG:32721",
        "referenceBand": "swir16"
    }, None))

    response = client.post("/api/forest/spectral", json={
        "geometry": AOI,
        "date": "2026-11-22",
        "collection": "sentinel-2-l2a",
        "indices": ["ndvi", "ndmi", "ndre"]
    })

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "REAL"
    assert payload["productId"] == "S2_TEST_SCENE"
    assert payload["resolution"] == 20
    assert payload["indices"]["ndvi"]["mean"] == 0.62
    assert payload["indices"]["ndre"]["status"] == "UNAVAILABLE"


def test_spectral_endpoint_rejects_unknown_index():
    response = client.post("/api/forest/spectral", json={
        "geometry": AOI,
        "date": "2026-11-22",
        "collection": "sentinel-2-l2a",
        "indices": ["ndvi", "made-up-index"]
    })
    assert response.status_code == 422


def test_spectral_endpoint_reports_no_scene_without_fabricating_zero(monkeypatch):
    from backend import main as api

    monkeypatch.setattr(api, "search_stac_catalog", lambda req: {
        "products": [],
        "message": "No scenes with valid assets"
    })
    response = client.post("/api/forest/spectral", json={
        "geometry": AOI,
        "date": "2026-11-22",
        "collection": "sentinel-2-l2a",
        "indices": ["ndvi"]
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "UNAVAILABLE"
    assert payload["indices"]["ndvi"]["status"] == "UNAVAILABLE"
    assert payload["attempts"][0]["status"] == "NO_VALID_SCENE"


@pytest.mark.parametrize(
    "index,expected",
    [
        ("ndvi", 0.5),
        ("evi", 2.5 * (0.6 - 0.2) / (0.6 + 6 * 0.2 - 7.5 * 0.1 + 1)),
        ("ndmi", (0.6 - 0.3) / (0.6 + 0.3)),
        ("gndvi", (0.6 - 0.3) / (0.6 + 0.3)),
        ("ndre", (0.6 - 0.4) / (0.6 + 0.4)),
    ],
)
def test_spectral_index_formulas_use_calibrated_band_arrays(index, expected):
    import numpy as np
    from backend.main import _spectral_index_array

    arrays = {
        "nir": np.array([0.6], dtype="float32"),
        "red": np.array([0.2], dtype="float32"),
        "blue": np.array([0.1], dtype="float32"),
        "swir16": np.array([0.3], dtype="float32"),
        "green": np.array([0.3], dtype="float32"),
        "rededge1": np.array([0.4], dtype="float32"),
    }
    result = _spectral_index_array(index, arrays)
    assert float(result[0]) == pytest.approx(expected, abs=1e-6)


def test_spectral_index_zero_denominator_returns_nan_not_zero():
    import numpy as np
    from backend.main import _spectral_index_array

    result = _spectral_index_array("ndvi", {
        "nir": np.array([0.0], dtype="float32"),
        "red": np.array([0.0], dtype="float32"),
    })
    assert np.isnan(result[0])
