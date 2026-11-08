from fastapi.testclient import TestClient
from backend import fire_monitoring as fire


def test_national_fire_endpoint_returns_feature_collection(monkeypatch):
    fire.CACHE["payload"] = None
    fire.CACHE["expires"] = 0

    def fake_fetch(item):
        name, _url = item
        sensor = "MODIS" if name == "MODIS" else "VIIRS"
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-56.0, -27.0]},
            "properties": {"source": "NASA FIRMS", "sensor": sensor, "date": "2026-11-08"},
        }
        return {"name": name, "ok": True, "count": 1, "lastModified": None, "features": [feature]}

    monkeypatch.setattr(fire, "_fetch_firms", fake_fetch)
    response = TestClient(fire.app).get("/api/fires/national")

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "FeatureCollection"
    assert len(payload["features"]) == 4
    assert {f["properties"]["sensor"] for f in payload["features"]} == {"MODIS", "VIIRS"}
