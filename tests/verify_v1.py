import pytest
from playwright.sync_api import sync_playwright
import subprocess
import time
import os

@pytest.fixture(scope="module", autouse=True)
def server():
    proc = subprocess.Popen(["python3", "-m", "http.server", "8000"])
    time.sleep(1)
    yield
    proc.terminate()

def test_search_and_results():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto("http://localhost:8000/index.html")

        # Verify GPS button exists on home page
        assert page.is_visible("#gpsBtn")

        # Search for Gobernador Virasoro
        page.fill("#provincias", "Gobernador Virasoro")
        page.click("button[type='submit']")

        page.wait_for_url("**/resultados.html?ubicacion=Gobernador%20Virasoro")

        # Wait for crop cards
        page.wait_for_selector(".crop-card")

        cards = page.query_selector_all(".crop-card")
        assert len(cards) > 0

        # Check map integration
        assert page.is_visible("#map")
        assert page.is_visible(".leaflet-container")

        # Check territory details loaded
        assert page.is_visible("#territory-details")
        page.wait_for_selector(".info-item")
        assert page.is_visible(".info-item")

        # Check compatibility badge
        assert page.is_visible(".compatibility-badge")

        browser.close()

def test_map_click_and_updates():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto("http://localhost:8000/resultados.html?ubicacion=Gobernador%20Virasoro")

        page.wait_for_selector(".leaflet-container")

        # Click on Misiones coordinates
        page.evaluate("procesarSeleccionCoordenadas(-26.8756, -54.6543)")

        page.wait_for_selector("#territory-details")

        page.wait_for_selector(".crop-card")
        cards = page.query_selector_all(".crop-card")
        assert len(cards) > 0

        # Check live weather section loaded
        assert page.is_visible("#live-weather-info")

        browser.close()

def test_normalization():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto("http://localhost:8000/resultados.html?ubicacion=%20%20gObErNaDoR%20%20vIrAsOrO%20%20")

        page.wait_for_selector(".crop-card")
        cards = page.query_selector_all(".crop-card")
        assert len(cards) > 0

        browser.close()

def test_forestal_page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto("http://localhost:8000/forestal.html")

        # Verify Leaflet map container
        assert page.is_visible("#forest-map")

        # Verify GPS button
        assert page.is_visible("#btn-gps-loc")

        # Verify GIS buttons
        assert page.is_visible("#btn-download-kml")
        assert page.is_visible("#btn-download-gpx")

        # Verify Field Forestry Inventory panel
        assert page.is_visible("#inv-especie")
        assert page.is_visible("#inv-dap")
        assert page.is_visible("#inv-altura")

        # Test calculating field inventory
        page.fill("#inv-dap", "26")
        page.fill("#inv-altura", "22")
        page.click("#btn-calc-inv")
        page.wait_for_timeout(300)
        assert page.is_visible("#inv-results-box")

        # Verify GeoJSON controls
        assert page.is_visible("#geojson-textarea")
        assert page.is_visible("#btn-run-analysis")

        # Click run analysis
        page.click("#btn-run-analysis")

        # Wait for printable forest report
        page.wait_for_selector("#printable-forest-report")
        assert page.is_visible("#printable-forest-report")

        browser.close()
