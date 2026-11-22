from fastapi.testclient import TestClient
import numpy as np
import time
import urllib.error
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


def test_argentina_mask_uses_official_geometry_to_exclude_neighbouring_countries(monkeypatch):
    from shapely.geometry import Polygon

    # Small fixture representing only the Argentine side of a border segment.
    argentina = Polygon([(-60, -30), (-58, -30), (-58, -28), (-60, -28), (-60, -30)])
    assert fire._inside_argentina(-59.0, -29.0, argentina) is True
    assert fire._inside_argentina(-57.5, -29.0, argentina) is False
    assert fire._inside_argentina(-59.0, -27.0, argentina) is False


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


def test_firms_last_modified_freshness_distinguishes_stale_and_fresh():
    now = fire.datetime.datetime(2026, 11, 17, 14, 0, tzinfo=fire.datetime.timezone.utc)
    stale = fire._last_modified_freshness("Thu, 12 Nov 2026 15:49:57 GMT", now=now)
    fresh = fire._last_modified_freshness("Tue, 17 Nov 2026 13:47:19 GMT", now=now)
    unknown = fire._last_modified_freshness(None, now=now)

    assert stale["stale"] is True
    assert stale["freshness"] == "stale"
    assert fresh["stale"] is False
    assert fresh["freshness"] == "fresh"
    assert unknown["stale"] is None
    assert unknown["freshness"] == "unknown"


def test_firms_stale_sources_are_excluded_from_live_features(monkeypatch):
    fire.CACHE["payload"] = None
    fire.CACHE["expires"] = 0

    def fake_fetch(item):
        name, _url = item
        stale = name == "VIIRS_SNPP"
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-56.0, -27.0]},
            "properties": {"source": "NASA FIRMS", "sensor": name, "date": "2026-11-17"},
        }
        return {
            "name": name, "ok": True, "count": 1,
            "lastModified": "Thu, 12 Nov 2026 15:49:57 GMT" if stale else "Tue, 17 Nov 2026 13:47:19 GMT",
            "stale": stale, "freshness": "stale" if stale else "fresh",
            "features": [feature],
        }

    monkeypatch.setattr(fire, "_fetch_firms", fake_fetch)
    payload = fire.national_fires()
    assert len(payload["features"]) == 3
    assert payload["meta"]["staleSources"] == ["VIIRS_SNPP"]


def _forecast_fixture():
    return {
        "daily": {
            "time": ["2026-11-08"],
            "temperature_2m_max": [34],
            "precipitation_sum": [0],
            "wind_speed_10m_max": [24],
            "wind_gusts_10m_max": [38],
        },
        "hourly": {
            "time": ["2026-11-08T00:00", "2026-11-08T12:00"],
            "relative_humidity_2m": [62, 24],
        },
    }


def test_fire_forecast_reuses_short_lived_cache_for_nearby_map_taps(monkeypatch):
    fire.FORECAST_CACHE.clear()
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return __import__("json").dumps(_forecast_fixture()).encode("utf-8")

    def fake_urlopen(request, **_kwargs):
        calls.append(request.full_url)
        return FakeResponse()

    monkeypatch.setattr(fire.urllib.request, "urlopen", fake_urlopen)
    first = fire.fire_weather_forecast(lat=-28.0501, lon=-56.0201)
    second = fire.fire_weather_forecast(lat=-28.0502, lon=-56.0202)

    assert len(calls) == 1
    assert first["meta"]["cached"] is False
    assert second["meta"]["cached"] is True
    assert second["location"]["latitude"] == -28.05
    assert second["meta"]["cacheCellDegrees"] == 0.001


def test_fire_forecast_returns_retry_after_when_provider_rate_limits(monkeypatch):
    fire.FORECAST_CACHE.clear()

    def rate_limited(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.open-meteo.com/v1/forecast", 429, "Too Many Requests",
            {"Retry-After": "120"}, None
        )

    monkeypatch.setattr(fire.urllib.request, "urlopen", rate_limited)
    response = TestClient(fire.app).get("/api/fires/forecast?lat=-28.05&lon=-56.02")

    assert response.status_code == 429
    assert response.headers["retry-after"] == "120"
    assert "limitó temporalmente" in response.json()["detail"]


def test_fire_forecast_serves_stale_cache_when_provider_is_unavailable(monkeypatch):
    fire.FORECAST_CACHE.clear()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return __import__("json").dumps(_forecast_fixture()).encode("utf-8")

    monkeypatch.setattr(fire.urllib.request, "urlopen", lambda *_args, **_kwargs: FakeResponse())
    initial = fire.fire_weather_forecast(lat=-28.05, lon=-56.02)
    key = fire._forecast_cache_key(-28.05, -56.02)
    fire.FORECAST_CACHE[key]["expires"] = time.monotonic() - 1
    fire.FORECAST_CACHE[key]["stale_expires"] = time.monotonic() + 120

    def unavailable(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://api.open-meteo.com/v1/forecast", 429, "Too Many Requests",
            {"Retry-After": "60"}, None
        )

    monkeypatch.setattr(fire.urllib.request, "urlopen", unavailable)
    stale = fire.fire_weather_forecast(lat=-28.05, lon=-56.02)

    assert stale["days"] == initial["days"]
    assert stale["meta"]["cached"] is True
    assert stale["meta"]["stale"] is True
    assert "Open-Meteo no respondió" in stale["meta"]["warning"]



def test_conae_wms_metadata_preserves_published_crs_bounds_and_queryability(monkeypatch):
    fire.CONAE_METADATA_CACHE.clear()
    xml = b"""<?xml version="1.0"?>
    <WMS_Capabilities version="1.3.0">
      <Service><Title>CONAE test service</Title></Service>
      <Capability><Layer><Title>Root</Title>
        <Layer queryable="1">
          <Name>EmergenciasCONAE:MODIS_AQM_1</Name>
          <Title>Monthly burned area</Title>
          <Abstract>MODIS Burn_Date product</Abstract>
          <CRS>EPSG:4326 EPSG:3857</CRS>
          <EX_GeographicBoundingBox>
            <westBoundLongitude>-75</westBoundLongitude>
            <eastBoundLongitude>-53</eastBoundLongitude>
            <southBoundLatitude>-56</southBoundLatitude>
            <northBoundLatitude>-21</northBoundLatitude>
          </EX_GeographicBoundingBox>
          <BoundingBox CRS="EPSG:4326" minx="-75" miny="-56" maxx="-53" maxy="-21"/>
          <Style><Name>burn_date</Name><Title>Burn date</Title></Style>
        </Layer>
      </Layer></Capability>
    </WMS_Capabilities>"""

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return xml

    monkeypatch.setattr(fire.urllib.request, "urlopen", lambda *_a, **_k: FakeResponse())
    payload = fire.conae_wms_metadata("burned")
    layer = next(item for item in payload["layers"] if item["name"] == "EmergenciasCONAE:MODIS_AQM_1")

    assert layer["queryable"] is True
    assert layer["crs"] == ["EPSG:4326", "EPSG:3857"]
    assert layer["geographicBounds"]["westBoundLongitude"] == "-75"
    assert layer["boundingBoxes"][0]["crs"] == "EPSG:4326"
    assert layer["styles"][0]["name"] == "burn_date"
    assert layer["abstract"] == "MODIS Burn_Date product"


def test_conae_wms_metadata_does_not_invent_missing_spatial_metadata(monkeypatch):
    fire.CONAE_METADATA_CACHE.clear()
    xml = b"""<WMS_Capabilities><Capability><Layer>
      <Layer><Name>AlertaTemprana:unknown</Name><Title>Unknown metadata</Title></Layer>
    </Layer></Capability></WMS_Capabilities>"""

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return xml

    monkeypatch.setattr(fire.urllib.request, "urlopen", lambda *_a, **_k: FakeResponse())
    payload = fire.conae_wms_metadata("fuel")
    layer = payload["layers"][0]

    assert layer["crs"] == []
    assert layer["boundingBoxes"] == []
    assert layer["geographicBounds"] is None
    assert layer["queryable"] is None


def test_conae_wms_metadata_rejects_unknown_product_kind():
    from fastapi import HTTPException

    try:
        fire.conae_wms_metadata("unknown")
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("Se esperaba HTTP 400 para un producto CONAE desconocido")


def test_conae_wms_metadata_fails_fast_when_provider_times_out(monkeypatch):
    from fastapi import HTTPException

    fire.CONAE_METADATA_CACHE.clear()

    def timeout(*_args, **_kwargs):
        raise TimeoutError("upstream timed out")

    monkeypatch.setattr(fire.urllib.request, "urlopen", timeout)
    try:
        fire.conae_wms_metadata("fuel")
    except HTTPException as exc:
        assert exc.status_code == 502
        assert "timed out" in exc.detail
    else:
        raise AssertionError("Se esperaba un error controlado cuando CONAE agota el tiempo de espera")
