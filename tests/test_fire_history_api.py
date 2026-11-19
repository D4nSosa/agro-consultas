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
