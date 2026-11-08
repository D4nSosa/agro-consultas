from fastapi.testclient import TestClient
import numpy as np
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
    assert result["score"] is None
    assert result["riskLabel"] == "No evaluable"
    assert result["riskClass"] == "no-evaluable"
    assert result["availableConditions"] == 0
    assert not any(result["conditions"].values())


def test_fire_forecast_aggregates_minimum_hourly_humidity(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return __import__("json").dumps({
                "daily": {
                    "time": ["2026-11-08"],
                    "temperature_2m_max": [34],
                    "precipitation_sum": [0],
                    "wind_speed_10m_max": [24],
                    "wind_gusts_10m_max": [38],
                },
                "hourly": {
                    "time": ["2026-11-08T00:00", "2026-11-08T12:00", "2026-11-08T18:00"],
                    "relative_humidity_2m": [62, 24, 31],
                },
            }).encode("utf-8")

    monkeypatch.setattr(fire.urllib.request, "urlopen", lambda *_args, **_kwargs: FakeResponse())
    result = fire.fire_weather_forecast(lat=-28.05, lon=-56.02)
    assert len(result["days"]) == 1
    assert result["days"][0]["humidityMin"] == 24
    assert result["days"][0]["score"] == 100
    assert result["days"][0]["riskClass"] == "muy-alto"


def test_fire_weather_indicator_reports_partial_data():
    result = fire._fire_weather_indicator(34, None, 28, None)
    assert result["score"] == 50
    assert result["availableConditions"] == 2
    assert result["requiredConditions"] == 4


def test_goes_sampling_spans_the_full_candidate_index_range():
    mask = np.full((100, 100), 10, dtype=np.int16)
    indices, total, truncated = fire._sample_detection_indices(mask, 100)
    assert total == 10000
    assert truncated is True
    assert len(indices) == 100
    assert indices[0, 0] == 0
    assert indices[-1, 0] == 99
    assert len(set(map(tuple, indices.tolist()))) == 100
