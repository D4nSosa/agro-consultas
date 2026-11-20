from fastapi.testclient import TestClient

from backend.fire_monitoring import app, _history_date_chunks

client = TestClient(app)

POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [-56.1, -27.1], [-56.0, -27.1], [-56.0, -27.0],
        [-56.1, -27.0], [-56.1, -27.1]
    ]]
}


def test_history_date_chunks_respect_firms_five_day_limit():
    import datetime

    chunks = list(_history_date_chunks(
        datetime.date(2026, 1, 1),
        datetime.date(2026, 1, 12),
    ))
    assert chunks == [
        (datetime.date(2026, 1, 1), 5),
        (datetime.date(2026, 1, 6), 5),
        (datetime.date(2026, 1, 11), 2),
    ]


def test_historical_endpoint_requires_server_side_firms_key(monkeypatch):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    response = client.post(
        "/api/fires/history",
        json={"geometry": POLYGON, "from": "2026-01-01", "to": "2026-01-05"},
    )
    assert response.status_code == 503
    assert "FIRMS_MAP_KEY" in response.json()["detail"]


def test_historical_endpoint_rejects_periods_over_31_days(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "test-key")
    response = client.post(
        "/api/fires/history",
        json={"geometry": POLYGON, "from": "2026-01-01", "to": "2026-02-01"},
    )
    assert response.status_code == 400
    assert "31 días" in response.json()["detail"]


def test_conae_metadata_rejects_unknown_service_kind():
    response = client.get("/api/fires/conae/metadata?kind=unknown")
    assert response.status_code == 400
    assert "burned o fuel" in response.json()["detail"]


def test_history_query_plan_uses_standard_when_available_and_nrt_for_recent_dates():
    import datetime
    from backend.fire_monitoring import _history_query_plan

    availability = {}
    for standard, near in [
        ("MODIS_SP", "MODIS_NRT"),
        ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
        ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
        ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT"),
    ]:
        availability[standard] = {
            "minDate": datetime.date(2020, 1, 1),
            "maxDate": datetime.date(2026, 10, 1),
        }
        availability[near] = {
            "minDate": datetime.date(2026, 10, 2),
            "maxDate": datetime.date(2026, 12, 31),
        }

    tasks, unavailable = _history_query_plan(
        datetime.date(2026, 9, 30), datetime.date(2026, 10, 3), availability
    )
    assert len(tasks) == 8
    assert tasks[0] == ("MODIS", "MODIS_SP", datetime.date(2026, 9, 30), 2)
    assert tasks[1] == ("MODIS", "MODIS_NRT", datetime.date(2026, 10, 2), 2)
    assert unavailable == {}


def test_history_query_plan_reports_dates_without_published_coverage():
    import datetime
    from backend.fire_monitoring import _history_query_plan

    tasks, unavailable = _history_query_plan(
        datetime.date(2026, 11, 1), datetime.date(2026, 11, 2), {}
    )
    assert tasks == []
    assert len(unavailable["MODIS"]) == 2
    assert len(unavailable["VIIRS_SNPP"]) == 2


def test_history_endpoint_caches_only_complete_results(monkeypatch):
    import datetime
    from backend import fire_monitoring as fire

    monkeypatch.setenv("FIRMS_MAP_KEY", "test-key")
    fire.HISTORY_CACHE.clear()
    fire.FIRMS_AVAILABILITY_CACHE.update({"expires": 0, "payload": None})
    availability = {
        source: {"minDate": datetime.date(2026, 1, 1), "maxDate": datetime.date(2026, 1, 31)}
        for family in fire.HISTORY_SENSOR_FAMILIES.values() for source in family
    }
    monkeypatch.setattr(fire, "_fetch_firms_availability", lambda *_args, **_kwargs: availability)
    calls = []

    def complete_fetch(_key, source, _bounds, start, end):
        calls.append(source)
        return [], []

    monkeypatch.setattr(fire, "_fetch_firms_history_source", complete_fetch)
    payload = {"geometry": POLYGON, "from": "2026-01-01", "to": "2026-01-02"}
    first = fire.historical_fires(payload)
    second = fire.historical_fires(payload)
    assert first["meta"]["complete"] is True
    assert second == first
    assert len(calls) == 4


def test_history_endpoint_does_not_cache_partial_results(monkeypatch):
    import datetime
    from backend import fire_monitoring as fire

    monkeypatch.setenv("FIRMS_MAP_KEY", "test-key")
    fire.HISTORY_CACHE.clear()
    availability = {
        source: {"minDate": datetime.date(2026, 1, 1), "maxDate": datetime.date(2026, 1, 31)}
        for family in fire.HISTORY_SENSOR_FAMILIES.values() for source in family
    }
    monkeypatch.setattr(fire, "_fetch_firms_availability", lambda *_args, **_kwargs: availability)
    calls = []

    def partial_fetch(_key, source, _bounds, start, end):
        calls.append(source)
        return [], ([source + " 2026-01-01: HTTP 403"] if source == "MODIS_SP" else [])

    monkeypatch.setattr(fire, "_fetch_firms_history_source", partial_fetch)
    payload = {"geometry": POLYGON, "from": "2026-01-01", "to": "2026-01-02"}
    first = fire.historical_fires(payload)
    second = fire.historical_fires(payload)
    assert first["meta"]["complete"] is False
    assert second["meta"]["complete"] is False
    assert len(calls) == 8
