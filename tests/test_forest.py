import pytest
import math
from fastapi.testclient import TestClient
from backend.main import app, calculate_shapely_area
from shapely.geometry import Polygon, shape

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

def test_area_calculation():
    poly = shape(SAMPLE_POLYGON_GEOMETRY)
    area_sq_m = calculate_shapely_area(poly)
    area_ha = area_sq_m / 10000.0
    assert area_ha > 0
    assert 2000 < area_ha < 4000

def test_api_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "copernicusCatalog" in data

def test_api_sample_lots():
    response = client.get("/api/forest/lots")
    assert response.status_code == 200
    lots = response.json()
    assert len(lots) >= 1
    assert lots[0]["primarySpecies"] == "Pino Taeda"

def test_api_stac_search():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "startDate": "2024-01-01",
        "endDate": "2024-06-01",
        "maxCloudCover": 30.0
    }
    response = client.post("/api/forest/stac", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "success" in data

def test_api_ndvi_calculation():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "date": "2024-05-15"
    }
    response = client.post("/api/forest/ndvi", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["indicator"] == "NDVI"
    assert "areaHectares" in data
    assert data["areaHectares"] > 0

def test_api_change_detection():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "dateA": "2024-01-01",
        "dateB": "2024-06-01"
    }
    response = client.post("/api/forest/changes", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "deltaNDVI" in data
    assert "classification" in data
    assert "breakdown" in data

def test_api_full_analysis():
    payload = {
        "geometry": SAMPLE_POLYGON_GEOMETRY,
        "dateA": "2024-01-01",
        "dateB": "2024-06-01"
    }
    response = client.post("/api/forest/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "stac" in data
    assert "changes" in data
