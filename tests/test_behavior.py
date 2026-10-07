import pytest
import os
import json
from fastapi.testclient import TestClient
from backend.main import app, calculate_shapely_area
from shapely.geometry import shape

client = TestClient(app)

SAMPLE_POLYGON_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[
        [-54.68, -26.85],
        [-54.62, -26.85],
        [-54.62, -26.90],
        [-54.68, -26.90],
        [-54.68, -26.85]
    ]]
}

SAMPLE_POINT_GEOMETRY = {
    "type": "Point",
    "coordinates": [-54.65, -26.87]
}

def test_polygon_vs_point_area():
    poly = shape(SAMPLE_POLYGON_GEOMETRY)
    poly_area = calculate_shapely_area(poly)
    assert poly_area > 0

    point = shape(SAMPLE_POINT_GEOMETRY)
    assert point.area == 0.0

def test_api_ndvi_point_area_zero():
    payload = {"geometry": SAMPLE_POINT_GEOMETRY, "date": "2024-05-15"}
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["areaHectares"] == 0.0
    assert data["isPoint"] is True

def test_api_ndvi_missing_credentials_message():
    # En ausencia de credenciales en entorno de test
    os.environ.pop("COPERNICUS_CLIENT_ID", None)
    os.environ.pop("COPERNICUS_CLIENT_SECRET", None)
    os.environ.pop("SENTINELHUB_CLIENT_ID", None)
    os.environ.pop("SENTINELHUB_CLIENT_SECRET", None)

    payload = {"geometry": SAMPLE_POLYGON_GEOMETRY, "date": "2024-05-15"}
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "UNAVAILABLE"
    assert "COPERNICUS_CLIENT_ID" in data["missingEnvVars"]
    assert "COPERNICUS_CLIENT_SECRET" in data["missingEnvVars"]
    assert data["stats"]["mean"] == "NO DISPONIBLE"

def test_change_detection_unavailable_without_raster():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "dateA": "2024-01-01",
        "dateB": "2024-06-01"
    }
    response = client.post("/api/forest/changes", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["classification"] == "NO_DISPONIBLE"
    assert data["deltaNDVI"] == "NO DISPONIBLE"
    assert data["breakdown"]["decrease"]["hectares"] == "N/D"

def test_cultivos_and_forestales_data_integrity():
    with open("data/cultivos.json", "r", encoding="utf-8") as f:
        cultivos = json.load(f)
    with open("data/forestales.json", "r", encoding="utf-8") as f:
        forestales = json.load(f)

    total_profiles = len(cultivos) + len(forestales)
    assert total_profiles >= 29, f"Se esperaban al menos 29 perfiles, se encontraron {total_profiles}"

    for key, c in {**cultivos, **forestales}.items():
        nombre = c.get("nombre") or key.capitalize()
        assert nombre is not None
        assert "descripcion" in c
        assert "reqSuelo" in c
        assert "reqClima" in c
