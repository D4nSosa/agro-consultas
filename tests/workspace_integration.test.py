from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PAGES = ["index.html", "mapa.html", "incendios.html", "resultados.html",
         "forestal.html", "tracking.html", "reporte.html"]

class WorkspaceIntegrationTests(unittest.TestCase):
    def test_all_primary_pages_load_shared_workspace_assets(self):
        for name in PAGES:
            with self.subTest(page=name):
                html = (ROOT / name).read_text(encoding="utf-8")
                self.assertIn('href="workspace.css"', html)
                self.assertIn('src="workspace.js"', html)

    def test_workspace_label_prefers_the_newest_saved_lot(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        self.assertIn("const candidates = []", js)
        self.assertIn("Date.parse(feature.properties?.updatedAt || '')", js)
        self.assertIn("candidates.sort((a, b) => b.timestamp - a.timestamp)", js)

    def test_shared_workspace_exposes_local_project_and_lot_switching(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        service = (ROOT / "services/lotContext.js").read_text(encoding="utf-8")
        self.assertIn("ac-project-select", js)
        self.assertIn("ac-lot-select", js)
        self.assertIn("createWorkspaceProject(name)", service)
        self.assertIn("selectWorkspaceProject(projectId)", service)
        self.assertIn("selectWorkspaceLot(lotId)", service)
        self.assertIn("agro_workspace_v1", service)

    def test_shared_navigation_has_all_work_modules(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        for route in ["mapa.html", "resultados.html", "forestal.html",
                      "incendios.html", "tracking.html", "reporte.html"]:
            self.assertIn(route, js)

    def test_mobile_workspace_is_map_first_and_has_safe_area(self):
        css = (ROOT / "workspace.css").read_text(encoding="utf-8")
        self.assertIn("@media(max-width:760px)", css)
        self.assertIn("env(safe-area-inset-bottom)", css)
        self.assertIn(".ac-mobile-nav", css)

    def test_desktop_and_mobile_navigation_are_both_rendered(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        self.assertIn("ac-workspace-links", js)
        self.assertIn("ac-mobile-nav", js)
        self.assertIn("aria-current", js)

    def test_fire_detection_carousel_is_interactive(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn('id="fire-detection-carousel"', source)
        self.assertIn("function renderRecentDetections()", source)
        self.assertIn("data-fire-index", source)
        self.assertIn("setContent(popup(feature))", source)

    def test_fire_carousel_sorts_timestamps_with_utc_offsets(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn("const hasTimezone=/(?:Z|[+-]\\\\d{2}:?\\\\d{2})$/i.test(value)", source)
        self.assertIn("Date.parse(value?(hasTimezone?value:value+'Z'):'')", source)

    def test_fire_and_climate_panels_avoid_generic_unavailable_labels(self):
        fire = (ROOT / "incendios.html").read_text(encoding="utf-8")
        results = (ROOT / "resultados.html").read_text(encoding="utf-8")
        self.assertNotIn("No evaluable", fire)
        self.assertIn("el indicador no se calcula", fire)
        self.assertNotIn("DATOS CLIMÁTICOS NO DISPONIBLES", results)

    def test_suitability_ui_uses_contextual_reference_labels(self):
        source = (ROOT / "script.js").read_text(encoding="utf-8")
        self.assertIn('const compatibilityLabel = isReferenceProfile ? "Perfil de referencia"', source)
        self.assertNotIn("Evidencia Insuficiente", source)
        self.assertNotIn("Datos Faltantes", source)
        self.assertNotIn("candidatos sin clasificación", source)
        self.assertNotIn("Otros perfiles sin clasificación", source)

    def test_map_tracking_and_forest_modules_subscribe_to_shared_lot_changes(self):
        checks = {
            "mapa.html": "onLotContextChange(feature=>",
            "tracking.html": "onLotContextChange(applySharedLot)",
            "forestal.html": "onLotContextChange(feature =>",
        }
        for page, expected in checks.items():
            with self.subTest(page=page):
                html = (ROOT / page).read_text(encoding="utf-8")
                self.assertIn(expected, html)

    def test_forest_map_can_clear_a_shared_lot(self):
        source = (ROOT / "forestal/components/ForestMap.js").read_text(encoding="utf-8")
        self.assertIn("clearGeoJSON()", source)
        self.assertIn("this.currentFeature = null", source)

    def test_tracking_navigation_persists_the_current_lot_first(self):
        html = (ROOT / "mapa.html").read_text(encoding="utf-8")
        self.assertIn("$('tracking').onclick=()=>{if(current)$('save').click();location.href='tracking.html';};", html)

    def test_report_reuses_subregional_and_historical_climate_evidence(self):
        html = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("getCropsToEvaluate(provKey, subregion)", html)
        self.assertIn("climateHistory?.data?.historicalAverages", html)
        self.assertIn("climatologyBaseline: '2001–2020'", html)
        self.assertIn("'Ficha de referencia'", html)
        self.assertNotIn('todasRecomendaciones.filter(c => c.compatibilidad', html)

    def test_report_uses_a_geometry_centroid_and_explains_its_source(self):
        html = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("calculateCentroid(parsedGeom)", html)
        self.assertIn("calculateArea(parsedGeom)", html)
        self.assertIn("geometryArea?.isPoint", html)
        self.assertIn("report-coords-method", html)
        self.assertNotIn("getBounds().getCenter()", html)

if __name__ == "__main__":
    unittest.main()
