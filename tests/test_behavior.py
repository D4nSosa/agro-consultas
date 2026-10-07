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

def test_catalog_exact_29_profiles_and_merge_integrity():
    with open("data/cultivos.json", "r", encoding="utf-8") as f:
        cultivos = json.load(f)
    with open("data/forestales.json", "r", encoding="utf-8") as f:
        forestales = json.load(f)

    # Merge simulación exacta de loadCultivosData
    merged = {}
    for k, v in cultivos.items():
        merged[k] = {"id": k, **v}
    for k, v in forestales.items():
        if k in merged:
            merged[k] = {**merged[k], **v}
        else:
            merged[k] = {"id": k, **v}

    assert len(merged) == 29, f"El catálogo normalizado debe contener exactamente 29 perfiles, se encontraron {len(merged)}"

    forestal_keys = ["pino taeda", "pino elliottii", "eucalyptus grandis", "eucalyptus globulus"]
    for fk in forestal_keys:
        assert fk in merged, f"Especie forestal {fk} no encontrada en el catálogo"
        assert merged[fk].get("nombre") is not None, f"Especie {fk} carece de atributo 'nombre'"
        assert len(merged[fk]["nombre"]) > 0

def test_gigantic_aoi_warning_threshold():
    gigantic_polygon = {
        "type": "Polygon",
        "coordinates": [[
            [-60.0, -30.0],
            [-50.0, -30.0],
            [-50.0, -20.0],
            [-60.0, -20.0],
            [-60.0, -30.0]
        ]]
    }
    poly = shape(gigantic_polygon)
    area_sq_deg = poly.area
    # Un área de 10x10 grados sexagesimales equivale a millones de ha
    assert area_sq_deg > 10.0

def test_api_validation_gigantic_geometry():
    gigantic_polygon = {
        "type": "Polygon",
        "coordinates": [[
            [-60.0, -30.0],
            [-50.0, -30.0],
            [-50.0, -20.0],
            [-60.0, -20.0],
            [-60.0, -30.0]
        ]]
    }
    payload = {"geometry": gigantic_polygon, "date": "2024-05-15"}
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 400
    assert "Superficie excesiva" in response.json()["detail"]

def test_api_validation_invalid_coords_range():
    out_of_bounds_polygon = {
        "type": "Polygon",
        "coordinates": [[
            [-200.0, -30.0],
            [-50.0, -30.0],
            [-50.0, -20.0],
            [-200.0, -20.0],
            [-200.0, -30.0]
        ]]
    }
    payload = {"geometry": out_of_bounds_polygon, "date": "2024-05-15"}
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 400
    assert "Coordenadas fuera del rango válido WGS84" in response.json()["detail"]
