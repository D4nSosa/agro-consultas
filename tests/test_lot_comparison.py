from fastapi.testclient import TestClient

from backend.main import app
from backend import processing_engine

client = TestClient(app)

LOT_A = {
    "type": "Polygon",
    "coordinates": [[[-54.70, -27.10], [-54.69, -27.10], [-54.69, -27.09], [-54.70, -27.09], [-54.70, -27.10]]],
}
LOT_B = {
    "type": "Polygon",
    "coordinates": [[[-54.68, -27.10], [-54.67, -27.10], [-54.67, -27.09], [-54.68, -27.09], [-54.68, -27.10]]],
}


def payload():
    return {
        "lots": [
            {"id": "lot-a", "name": "Lote A", "geometry": LOT_A},
            {"id": "lot-b", "name": "Lote B", "geometry": LOT_B},
        ],
        "processors": ["hansen"],
    }


def test_compare_runs_same_processor_for_each_lot_and_returns_chart_ready_metrics(monkeypatch):
    calls = []

    def fake_processor(processor, geometry, request):
        calls.append((processor, geometry))
        value = 18.0 if len(calls) == 1 else 24.0
        return {
            "success": True,
            "source": "Hansen test fixture",
            "stats": {"treecover_mean": value, "valid_pixels": 100},
        }

    monkeypatch.setattr(processing_engine, "_run_comparison_processor", fake_processor)
    response = client.post("/api/engine/compare", json=payload())

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "PROCESSED"
    assert len(calls) == 2
    assert calls[0][0] == calls[1][0] == "hansen"
    assert len(result["lots"]) == 2
    assert result["comparisons"]["hansen"]
    treecover = next(row for row in result["comparisons"]["hansen"] if row["metric"] == "stats.treecover_mean")
    assert [item["value"] for item in treecover["values"]] == [18.0, 24.0]
    assert treecover["values"][1]["differenceFromFirst"] == 6.0
    assert result["chartSeries"]["hansen"]


def test_compare_does_not_turn_unavailable_lot_into_zero(monkeypatch):
    calls = 0

    def fake_processor(processor, geometry, request):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("upstream unavailable")
        return {"success": True, "stats": {"mean": 0.0}}

    monkeypatch.setattr(processing_engine, "_run_comparison_processor", fake_processor)
    response = client.post("/api/engine/compare", json=payload())

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "PARTIAL"
    assert result["lots"][1]["datasets"]["hansen"]["status"] == "PROCESSING_UNAVAILABLE"
    assert result["lots"][1]["datasets"]["hansen"]["error"]
    assert result["comparisons"]["hansen"] == []


def test_compare_rejects_duplicate_lot_ids():
    request = payload()
    request["lots"][1]["id"] = request["lots"][0]["id"]
    response = client.post("/api/engine/compare", json=request)
    assert response.status_code == 422


def test_compare_requires_polygon_geometries():
    request = payload()
    request["lots"][1]["geometry"] = {"type": "Point", "coordinates": [-54.68, -27.10]}
    response = client.post("/api/engine/compare", json=request)
    assert response.status_code == 422


def test_compare_requires_shared_gaez_parameters():
    request = payload()
    request["processors"] = ["gaez"]
    response = client.post("/api/engine/compare", json=request)
    assert response.status_code == 422
    assert "mapset_code" in response.json()["detail"]


def test_compare_rejects_unapproved_processor():
    request = payload()
    request["processors"] = ["arbitrary"]
    response = client.post("/api/engine/compare", json=request)
    assert response.status_code == 422


def test_numeric_metrics_excludes_pixel_counters_but_keeps_areas_and_percentages():
    metrics = processing_engine._numeric_metrics({
        "area_ha": 12.5,
        "valid_pixels": 400,
        "tiles_read": 2,
        "drivers": [
            {"code": 1, "driver": "Agricultura permanente", "area_ha": 4.5, "share_percent": 36.0, "pixels": 20},
            {"code": 5, "driver": "Incendios", "area_ha": 8.0, "share_percent": 64.0, "pixels": 30},
        ],
    })
    assert metrics["area_ha"] == 12.5
    assert metrics["drivers[1:Agricultura permanente].area_ha"] == 4.5
    assert metrics["drivers[5:Incendios].share_percent"] == 64.0
    assert "valid_pixels" not in metrics
    assert "tiles_read" not in metrics
    assert "drivers[1:Agricultura permanente].pixels" not in metrics


def test_spectral_lot_comparison_requires_matching_acquisition_signature(monkeypatch):
    calls = 0

    def fake_processor(processor, geometry, request):
        nonlocal calls
        calls += 1
        acquisition_date = "2026-11-18" if calls == 1 else "2026-11-20"
        return {
            "status": "REAL",
            "date": acquisition_date,
            "collection": "sentinel-2-l2a",
            "resolution": 20,
            "indices": {"ndvi": {"status": "REAL", "mean": 0.4 + calls / 10}},
        }

    monkeypatch.setattr(processing_engine, "_run_comparison_processor", fake_processor)
    request = payload()
    request["processors"] = ["spectral"]
    response = client.post("/api/engine/compare", json=request)

    assert response.status_code == 200
    result = response.json()
    assert result["comparisons"]["spectral"] == []
    assert "misma fecha de adquisición" in result["comparisonNotes"]["spectral"]


def test_spectral_lot_comparison_compares_matching_scene_date_and_resolution(monkeypatch):
    def fake_processor(processor, geometry, request):
        return {
            "status": "REAL",
            "date": "2026-11-20",
            "collection": "sentinel-2-l2a",
            "resolution": 20,
            "indices": {"ndvi": {"status": "REAL", "mean": 0.42 if geometry["coordinates"][0][0][0] < -54.69 else 0.57}},
        }

    monkeypatch.setattr(processing_engine, "_run_comparison_processor", fake_processor)
    request = payload()
    request["processors"] = ["spectral"]
    response = client.post("/api/engine/compare", json=request)

    assert response.status_code == 200
    result = response.json()
    row = next(item for item in result["comparisons"]["spectral"] if item["metric"] == "indices.ndvi.mean")
    assert [item["value"] for item in row["values"]] == [0.42, 0.57]
