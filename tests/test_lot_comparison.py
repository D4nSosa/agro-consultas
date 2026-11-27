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
