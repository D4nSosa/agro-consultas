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
        assert first_card_title in ["Soja", "Maiz", "Trigo", "Mani"]

        # Check if description and details are present
        assert page.is_visible(".desc")
        assert page.is_visible(".details")

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
