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


def test_fire_weather_indicator_uses_transparent_weather_thresholds():
    low = fire._fire_weather_indicator(22, 55, 12, 8)
    high = fire._fire_weather_indicator(34, 20, 28, 0)
    assert low["score"] == 0
    assert low["riskClass"] == "bajo"
    assert high["score"] == 100
    assert high["riskClass"] == "muy-alto"
    assert all(high["conditions"].values())


def test_fire_weather_indicator_handles_missing_values_without_inventing_data():
    result = fire._fire_weather_indicator(None, None, None, None)
    assert result["score"] == 0
    assert not any(result["conditions"].values())
