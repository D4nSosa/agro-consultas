import io
import json
import urllib.error

import backend.fire_monitoring as fire


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit=-1):
        return self.payload


def _reset(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "test-map-key")
    fire.FIRMS_STATUS_CACHE.update({"payload": None, "expires": 0.0})
    fire.FIRMS_RATE_LIMIT_CACHE["until"] = 0.0


def test_status_does_not_trust_local_rate_limit_as_key_validation(monkeypatch):
    _reset(monkeypatch)
    fire.FIRMS_RATE_LIMIT_CACHE["until"] = fire.time.monotonic() + 500
    calls = []

    def fake_urlopen(request, timeout=10):
        calls.append(request.full_url)
        return FakeResponse(json.dumps({
            "transaction_limit": 5000,
            "current_transactions": 12,
            "transaction_interval": 600,
        }).encode())

    monkeypatch.setattr(fire.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(fire, "_fetch_firms_availability", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("NASA respondió HTTP 403 sin detalle de cuota.")))
    result = fire.historical_fires_status()

    assert calls and "mapkey_status" in calls[0]
    assert result["valid"] is True
    assert result["rateLimited"] is False
    assert result["retryAfterSeconds"] is None
    assert "confirmó la MAP_KEY" in result["message"]


def test_ambiguous_403_does_not_claim_valid_key_or_rate_limit(monkeypatch):
    _reset(monkeypatch)

    def forbidden(request, timeout=10):
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO(b"Forbidden"))

    monkeypatch.setattr(fire.urllib.request, "urlopen", forbidden)
    monkeypatch.setattr(fire, "_fetch_firms_availability", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("NASA respondió HTTP 403, pero no informó si el rechazo corresponde a credenciales, cuota o parámetros.")))
    result = fire.historical_fires_status()

    assert result["valid"] is None
    assert result["rateLimited"] is False
    assert result["retryAfterSeconds"] is None


def test_http_401_is_authentication_failure_not_quota(monkeypatch):
    _reset(monkeypatch)

    def unauthorized(request, timeout=10):
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(b"Unauthorized"))

    monkeypatch.setattr(fire.urllib.request, "urlopen", unauthorized)
    monkeypatch.setattr(fire, "_fetch_firms_availability", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("NASA rechazó la autenticación de la solicitud (HTTP 401).")))
    result = fire.historical_fires_status()

    assert result["valid"] is False
    assert result["rateLimited"] is False
