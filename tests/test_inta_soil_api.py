import json
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

import backend.main as backend


def _fake_inta_urlopen(values_by_layer, calls):
    def fake_urlopen(request, timeout=0):
        query = parse_qs(urlparse(request.full_url).query)
        layer = query["layers"][0]
        calls.append(layer)
        value = values_by_layer.get(layer)
        if isinstance(value, Exception):
            raise value
        if value is None:
            payload = {"features": []}
        else:
            payload = {"features": [{"id": "", "properties": {"GRAY_INDEX": value}}]}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit=0):
                return json.dumps(payload).encode("utf-8")

        return FakeResponse()

    return fake_urlopen


def _values(ph_top=6.5, ph_deep=7.1, sal_top=2, sal_deep=1):
    return {
        backend.INTA_SOIL_PRODUCTS["ph_0_30"]["layer"]: ph_top,
        backend.INTA_SOIL_PRODUCTS["ph_30_100"]["layer"]: ph_deep,
        backend.INTA_SOIL_PRODUCTS["salinity_0_30"]["layer"]: sal_top,
        backend.INTA_SOIL_PRODUCTS["salinity_30_100"]["layer"]: sal_deep,
    }


def test_inta_national_soil_api_returns_pH_depths_and_raw_salinity_classes(monkeypatch):
    backend.INTA_SOIL_CACHE.clear()
    calls = []
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        _fake_inta_urlopen(_values(), calls)
    )

    result = backend.get_inta_national_soil_data(lat=-27.0, lng=-58.0)

    assert result["status"] == "CARTOGRAPHIC"
    assert result["source"] == "INTA - Centro de Investigación de Recursos Naturales (CIRN)"
    assert result["products"]["ph_0_30"]["value"] == 6.5
    assert result["products"]["ph_30_100"]["value"] == 7.1
    assert result["products"]["ph_0_30"]["resolution"] == 1000
    assert result["products"]["ph_0_30"]["quality"] == {"rmse": 0.84, "r2": 0.456}
    assert result["products"]["salinity_0_30"]["value"] is None
    assert result["products"]["salinity_0_30"]["rawClass"] == 2
    assert result["acquiredAt"] is None
    assert result["publishedAt"] is None
    assert result["sampleMethod"].startswith("Punto de consulta")
    assert len(calls) == 4


def test_inta_national_soil_api_treats_sentinel_values_as_nodata(monkeypatch):
    backend.INTA_SOIL_CACHE.clear()
    values = _values(ph_top=100, ph_deep=100, sal_top=-9999, sal_deep=-9999)
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        _fake_inta_urlopen(values, [])
    )

    result = backend.get_inta_national_soil_data(lat=-34.6, lng=-58.4)

    assert result["status"] == "UNAVAILABLE"
    assert result["products"]["ph_0_30"]["value"] is None
    assert result["products"]["ph_0_30"]["rawValue"] == 100
    assert result["products"]["salinity_0_30"]["rawClass"] is None
    assert result["products"]["salinity_0_30"]["rawValue"] == -9999


def test_inta_national_soil_api_returns_partial_results_when_a_layer_fails(monkeypatch):
    backend.INTA_SOIL_CACHE.clear()
    values = _values()
    failed_layer = backend.INTA_SOIL_PRODUCTS["ph_30_100"]["layer"]
    values[failed_layer] = RuntimeError("temporary WMS outage")
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        _fake_inta_urlopen(values, [])
    )

    result = backend.get_inta_national_soil_data(lat=-27.0, lng=-58.0)

    assert result["status"] == "PARTIAL"
    assert result["products"]["ph_0_30"]["value"] == 6.5
    assert result["products"]["ph_30_100"]["status"] == "UNAVAILABLE"


def test_inta_national_soil_api_caches_successful_point_results(monkeypatch):
    backend.INTA_SOIL_CACHE.clear()
    calls = []
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        _fake_inta_urlopen(_values(), calls)
    )

    first = backend.get_inta_national_soil_data(lat=-27.0, lng=-58.0)
    second = backend.get_inta_national_soil_data(lat=-27.0001, lng=-58.0001)

    assert first["cacheHit"] is False
    assert second["cacheHit"] is True
    assert len(calls) == 4


def test_inta_national_soil_api_rejects_invalid_coordinates():
    with pytest.raises(HTTPException) as exc:
        backend.get_inta_national_soil_data(lat=91.0, lng=0.0)
    assert exc.value.status_code == 400

def test_inta_national_soil_api_rejects_non_finite_raw_values(monkeypatch):
    backend.INTA_SOIL_CACHE.clear()
    values = _values(ph_top=float("nan"), ph_deep=float("inf"), sal_top=float("nan"), sal_deep=float("-inf"))
    monkeypatch.setattr(
        backend.urllib.request,
        "urlopen",
        _fake_inta_urlopen(values, [])
    )

    result = backend.get_inta_national_soil_data(lat=-27.0, lng=-58.0)

    assert result["status"] == "UNAVAILABLE"
    for product in result["products"].values():
        assert product["value"] is None
        assert product["rawValue"] is None
        assert product["rawClass"] is None
