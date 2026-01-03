import re
from playwright.sync_api import Page, expect

def test_seasonality_chart_loads(page: Page):
    # We need to serve the file via a web server to avoid CORS issues
    # The test runner in the cloud will handle this automatically
    page.goto("http://localhost:8000/resultados.html?ubicacion=62")

    # Wait for the map to be fully loaded
    page.wait_for_selector('#mapid .leaflet-tile-loaded')
    page.wait_for_timeout(1000) # extra wait for layers

    # Check that the chart is visible
    chart = page.locator("#seasonalityChart")
    expect(chart).to_be_visible()

    # Take a screenshot to verify the chart's appearance
    page.screenshot(path="tests/screenshots/seasonality_chart.png")
