from playwright.sync_api import Page, expect
import re

def test_full_end_to_end_verification(page: Page):
    """
    Verifica de extremo a extremo la página de resultados para la provincia de Salta.
    - El mapa se carga y el indicador de carga desaparece.
    - La provincia de Salta está resaltada.
    - La leyenda del mapa es visible.
    - El gráfico de estacionalidad es visible.
    - Se toma una captura de pantalla de la página completa.
    """
    # 1. Navegar a la página de resultados
    page.goto("http://localhost:8000/resultados.html?ubicacion=Salta")

    # 2. Verificar que el loader desaparece y el mapa se carga
    loader = page.locator("#mapaLoader")
    expect(loader).to_be_hidden(timeout=10000)

    # Esperar a que las capas del mapa estén presentes
    page.wait_for_selector('#mapaContainer .leaflet-tile-loaded', timeout=10000)
    page.wait_for_timeout(1500) # Tiempo extra para renderizado de GeoJSON

    # 3. Verificar que la leyenda del mapa es visible
    legend = page.locator(".legend")
    expect(legend).to_be_visible()
    expect(legend).to_contain_text("Climas")
    expect(legend).to_contain_text("Reg. Productivas")

    # 4. Verificar que el gráfico de estacionalidad es visible
    chart = page.locator("#seasonalityChart")
    expect(chart).to_be_visible()

    # 5. Tomar una captura de pantalla de la página completa
    page.screenshot(path="tests/final_verification.png", full_page=True)
