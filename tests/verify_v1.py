import pytest
from playwright.sync_api import sync_playwright
import subprocess
import time
import os

@pytest.fixture(scope="module", autouse=True)
def server():
    # Start the server
    proc = subprocess.Popen(["python3", "-m", "http.server", "8000"])
    time.sleep(1)  # Give the server a moment to start
    yield
    proc.terminate()

def test_search_and_results():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Go to home page
        page.goto("http://localhost:8000/index.html")

        # Verify GPS button exists on home page
        assert page.is_visible("#gpsBtn")

        # Search for Cordoba
        page.fill("#provincias", "Cordoba")
        page.click("button[type='submit']")

        # Wait for redirect and results
        page.wait_for_url("**/resultados.html?ubicacion=Cordoba")

        # Check if crop cards are visible
        page.wait_for_selector(".crop-card")

        cards = page.query_selector_all(".crop-card")
        assert len(cards) > 0

        # Check specific crop
        first_card_title = cards[0].query_selector("h3").inner_text()
        assert first_card_title in ["Soja", "Maiz", "Trigo", "Mani", "Pino Taeda", "Pino Elliottii", "Eucalyptus Grandis", "Eucalyptus Globulus"]

        # Check if description and details are present
        assert page.is_visible(".desc")
        assert page.is_visible(".crop-grid-details")

        # Check map integration (Fase 1)
        assert page.is_visible("#map")
        assert page.is_visible(".leaflet-container")

        # Check territory details loaded (Fase 2)
        assert page.is_visible("#territory-details")
        page.wait_for_selector(".info-item")
        assert page.is_visible(".info-item")

        # Check recommendation engine details (Fase 3)
        assert page.is_visible(".compatibility-badge")
        assert page.is_visible(".compatibility-report")

        # Verify Simulador Lote Agrícola UI exists
        assert page.is_visible("#sim-ph")
        assert page.is_visible("#sim-textura")
        assert page.is_visible("#sim-drenaje")
        assert page.is_visible("#sim-limitantes")
        assert page.is_visible("#btn-simular")
        assert page.is_visible("#btn-restablecer-sim")

        browser.close()

def test_map_click_and_updates():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Go straight to Misiones results
        page.goto("http://localhost:8000/resultados.html?ubicacion=Misiones")

        # Wait for map to be fully loaded
        page.wait_for_selector(".leaflet-container")

        # Click on the map to trigger location change (simulated coordinates selection)
        # Instead of coordinate click which is hard to mock in headless, we can call the js method directly on window
        page.evaluate("procesarSeleccionCoordenadas(-26.8756, -54.6543)")

        # Verify territory is updated to Misiones
        page.wait_for_selector("#territory-details")

        # Check if Misiones-specific soils & crops (Yerba mate) are recommended
        page.wait_for_selector(".crop-card")
        card_titles = [card.query_selector("h3").inner_text().lower() for card in page.query_selector_all(".crop-card")]
        assert "yerba mate" in card_titles or "te" in card_titles

        # Check if Misiones laterite soil detail exists
        details_text = page.locator("#territory-details").inner_text()
        assert "Lateríticos" in details_text or "Rojos" in details_text

        # Click on the map coordinate corresponding to Chaco
        page.evaluate("procesarSeleccionCoordenadas(-26.3860, -60.7653)")

        # Check if Chaco is selected
        page.wait_for_selector("#territory-details")
        details_text_chaco = page.locator("#territory-details").inner_text()
        assert "Chaco" in details_text_chaco or "Vertisoles" in details_text_chaco

        # Click on the map coordinate corresponding to Mendoza (Cuyo Region)
        page.evaluate("procesarSeleccionCoordenadas(-34.6297, -68.5831)")
        page.wait_for_selector("#territory-details")
        details_text_mendoza = page.locator("#territory-details").inner_text()
        assert "Mendoza" in details_text_mendoza
        assert "Aridisoles" in details_text_mendoza or "deshielo" in details_text_mendoza

        # Click on the map coordinate corresponding to Córdoba (Pampean Region)
        page.evaluate("procesarSeleccionCoordenadas(-32.1300, -63.7000)")
        page.wait_for_selector("#territory-details")
        details_text_cordoba = page.locator("#territory-details").inner_text()
        assert "Córdoba" in details_text_cordoba
        assert "Molisoles" in details_text_cordoba or "Maní" in details_text_cordoba

        # Test subregional resolution and live weather integration (Fase A & B)
        # Select Córdoba Sur (Zona Manicera) specifically
        page.evaluate("procesarSeleccionCoordenadas(-33.3, -64.3)")
        page.wait_for_selector("#territory-details")

        details_text_subregion = page.locator("#territory-details").inner_text()
        assert "Córdoba" in details_text_subregion
        assert "Zona Manicera" in details_text_subregion
        assert "Suelos sueltos" in details_text_subregion or "Molisoles" in details_text_subregion

        # Verify that Live Weather section (Fase B) loaded and has content or spinner
        assert page.is_visible("#live-weather-info")

        # Verify that sustainable and rotative crop report sections are present in cards (Fase C)
        page.wait_for_selector(".sustainability-report")
        sustainability_text = page.locator(".sustainability-report").first.inner_text()
        assert "Manejo Sostenible" in sustainability_text
        assert "Rotación" in sustainability_text

        # TEST SIMULATOR ACTION (FASE 5)
        # Set pH to extremely low (4.2) and recalculate compatibility
        page.fill("#sim-ph", "4.2")
        page.select_option("#sim-textura", "arcillosa")
        page.select_option("#sim-drenaje", "pobre")
        page.select_option("#sim-limitantes", "salinidad")
        page.click("#btn-simular")

        # Let it render
        page.wait_for_timeout(500)

        # Under extreme acid/salinity/poor drainage conditions, standard crops like Soy/Maiz should drop compatibility
        # Check first card's compatibility badge text (e.g. BAJA or MEDIA)
        first_badge = page.locator(".compatibility-badge").first.inner_text()
        assert "BAJA" in first_badge or "MEDIA" in first_badge

        browser.close()

def test_normalization():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Direct access with weird formatting
        page.goto("http://localhost:8000/resultados.html?ubicacion=%20%20bUeNoS%20%20aiReS%20%20")

        page.wait_for_selector(".crop-card")
        cards = page.query_selector_all(".crop-card")
        assert len(cards) > 0

        browser.close()

def test_forestal_page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Access Forestal page
        page.goto("http://localhost:8000/forestal.html")

        # Verify Leaflet map container
        assert page.is_visible("#forest-map")

        # Verify GPS field location button
        assert page.is_visible("#btn-gps-loc")

        # Verify GIS interoperability buttons (KML, GPX, PyQGIS)
        assert page.is_visible("#btn-download-kml")
        assert page.is_visible("#btn-download-gpx")
        assert page.is_visible("#btn-download-pyqgis")

        # Verify Field Forestry Inventory panel
        assert page.is_visible("#inv-especie")
        assert page.is_visible("#inv-dap")
        assert page.is_visible("#inv-altura")
        assert page.is_visible("#inv-densidad")
        assert page.is_visible("#inv-edad")
        assert page.is_visible("#btn-calc-inv")

        # Test calculating field inventory
        page.fill("#inv-dap", "26")
        page.fill("#inv-altura", "22")
        page.click("#btn-calc-inv")
        page.wait_for_timeout(300)
        assert page.is_visible("#inv-results-box")

        # Verify lot controls and GeoJSON text area
        assert page.is_visible("#geojson-textarea")
        assert page.is_visible("#btn-run-analysis")

        # Load demo lot and execute analysis
        page.click("#btn-load-sample")
        page.click("#btn-run-analysis")

        # Wait for auto analysis to load timeline and report
        page.wait_for_selector(".timeline-card")
        assert page.is_visible("#printable-forest-report")

        # Verify report traceability content
        report_text = page.locator("#printable-forest-report").inner_text()
        assert "Copernicus" in report_text
        assert "Sentinel-2" in report_text
        assert "NDVI" in report_text
        assert "Análisis preliminar" in report_text

        browser.close()
