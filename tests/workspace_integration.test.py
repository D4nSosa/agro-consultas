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
                self.assertIn('<script type="module" src="workspace.js"></script>', html)

    def test_workspace_shell_reads_the_active_project_and_lot(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        self.assertIn("getWorkspaceState()", js)
        self.assertIn("getLotContext()", js)
        self.assertIn("ac-project-select", js)
        self.assertIn("ac-lot-select", js)

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

    def test_mobile_navigation_and_contextual_workspace_are_rendered(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        self.assertNotIn("ac-workspace-links", js)
        self.assertNotIn("app-header", js)
        self.assertIn("ac-workspace-entry", js)
        self.assertIn("ac-mobile-nav", js)
        self.assertIn("aria-current", js)

    def test_fire_detection_carousel_is_interactive(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn('id="fire-detection-carousel"', source)
        self.assertIn("function renderRecentDetections()", source)
        self.assertIn("data-fire-index", source)
        self.assertIn("setContent(popup(feature))", source)

    def test_fire_carousel_sorts_iso_and_hhmm_satellite_timestamps(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn("const rawTime=String(p.timeUtc||'0000').padStart(4,'0')", source)
        self.assertIn("const parsed=Date.parse(value)", source)

    def test_fire_and_climate_panels_avoid_generic_unavailable_labels(self):
        fire = (ROOT / "incendios.html").read_text(encoding="utf-8")
        results = (ROOT / "resultados.html").read_text(encoding="utf-8")
        self.assertNotIn("No evaluable", fire)
        self.assertIn("No es un índice oficial de peligro de incendio", fire)
        self.assertNotIn("DATOS CLIMÁTICOS NO DISPONIBLES", results)

    def test_location_and_radar_empty_states_are_contextual(self):
        source = (ROOT / "script.js").read_text(encoding="utf-8")
        self.assertIn("Consulta radar Sentinel-1", source)
        self.assertIn("No encontramos esa ubicación", source)
        self.assertIn("Sin coordenadas GPS", source)
        self.assertNotIn("DATOS RADAR NO DISPONIBLES", source)
        self.assertNotIn("NO DISPONIBLE / UBICACIÓN NO ENCONTRADA", source)

    def test_climate_history_errors_are_contextual(self):
        source = (ROOT / "script.js").read_text(encoding="utf-8")
        self.assertIn("Serie histórica de NASA POWER", source)
        self.assertIn("La consulta de la serie histórica para estas coordenadas no pudo completarse", source)
        self.assertNotIn("DATOS CLIMÁTICOS NO DISPONIBLES", source)

    def test_suitability_ui_uses_contextual_reference_labels(self):
        source = (ROOT / "script.js").read_text(encoding="utf-8")
        self.assertIn('const compatibilityLabel = isReferenceProfile ? "Perfil de referencia"', source)
        self.assertNotIn("Evidencia Insuficiente", source)
        self.assertNotIn("Datos Faltantes", source)
        self.assertNotIn("candidatos sin clasificación", source)
        self.assertNotIn("Otros perfiles sin clasificación", source)

    def test_agro_suitability_subscribes_to_workspace_lot_changes(self):
        source = (ROOT / "script.js").read_text(encoding="utf-8")
        self.assertIn("onLotContextChange(async feature =>", source)
        self.assertIn("await renderRecomendaciones('Sin seleccionar', null, null)", source)
        self.assertIn("await renderHistoriaClimaticaUI(null, null, '')", source)

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

    def test_tracking_defers_lot_switches_during_gps_capture(self):
        html = (ROOT / "tracking.html").read_text(encoding="utf-8")
        self.assertIn("if (watchId !== null) return; // El cambio se aplica al detener o cerrar el recorrido.", html)
        self.assertIn("applySharedLotRef(getLotContext())", html)
        self.assertIn("if (!polygonLayer || !map.hasLayer(polygonLayer))", html)

    def test_tracking_navigation_persists_the_current_lot_first(self):
        html = (ROOT / "mapa.html").read_text(encoding="utf-8")
        self.assertIn("$('tracking').onclick=()=>{if(current)$('save').click();location.href='tracking.html';};", html)

    def test_report_reuses_saved_subregional_and_historical_climate_evidence(self):
        html = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("reportSections['agro-territory']", html)
        self.assertIn("reportSections['agro-environment']", html)
        self.assertIn("reportSections['agro-recommendations']", html)
        self.assertIn("climateHistory?.data?.historicalAverages", html)
        self.assertIn("'Ficha de referencia'", html)
        self.assertNotIn("getCropsToEvaluate", html)
        self.assertNotIn("generateRecommendations", html)
        self.assertNotIn('todasRecomendaciones.filter(c => c.compatibilidad', html)

    def test_report_uses_a_geometry_centroid_and_explains_its_source(self):
        html = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("calculateCentroid(parsedGeom)", html)
        self.assertIn("calculateArea(parsedGeom)", html)
        self.assertIn("geometryArea?.isPoint", html)
        self.assertIn("report-coords-method", html)
        self.assertNotIn("getBounds().getCenter()", html)

    def test_mobile_shell_reuses_original_brand_and_moves_project_controls_to_dialog(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        css = (ROOT / "workspace.css").read_text(encoding="utf-8")
        self.assertNotIn("ac-workspace-bar", js)
        self.assertIn("ac-workspace-dialog", js)
        self.assertIn("ac-open-workspace", js)
        self.assertIn("ac-workspace-entry", js)
        self.assertIn("path === 'reporte.html') window.location.reload()", js)
        self.assertIn(".app-header .right a{display:none!important}", css)
        self.assertIn(".ac-mobile-nav", css)

    def test_fire_module_offers_explicit_live_location_and_plain_language_summary(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn('id="locate-me"', source)
        self.assertIn("navigator.geolocation.watchPosition", source)
        self.assertIn("fire-summary", source)
        self.assertIn("no representan incendios confirmados", source.lower())
        self.assertIn("Too Many Requests", source)

    def test_national_conae_fire_layers_are_available_as_optional_context(self):
        source = (ROOT / "incendios.html").read_text(encoding="utf-8")
        self.assertIn("geoservicios2.conae.gov.ar/geoserver/EmergenciasCONAE/wms", source)
        self.assertIn("EmergenciasCONAE:MODIS_AQM_1", source)
        self.assertIn("geoservicios.conae.gov.ar/geoserver/AlertaTemprana/wms", source)
        self.assertIn("AlertaTemprana:INC_SIARTIVGEOL89_DC_1", source)
        self.assertIn("AlertaTemprana:INC_SIARTIVGEOSNPP_DC_6", source)
        self.assertIn('id="burned-product"', source)
        self.assertIn('id="fuel-product"', source)

    def test_forest_module_exposes_national_conae_forest_cover_reference_layer(self):
        source = (ROOT / "forestal/components/ForestMap.js").read_text(encoding="utf-8")
        self.assertIn("geoservicios2.conae.gov.ar/geoserver/Bosques/wms", source)
        self.assertIn("Bosques:CoberturaBosque_Argentina_2020", source)
        self.assertIn("referencia nacional histórica", source)
        self.assertIn("tiles.globalforestwatch.org/arg_otbn_forest_loss/v2022/dynamic/", source)
        self.assertIn("Pérdida histórica de bosque nativo · GFW 2007–2022", source)

    def test_report_includes_fire_and_field_sections_and_reads_saved_module_results(self):
        source = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("Observaciones satelitales de incendios", source)
        self.assertIn("Campo y geometría relevada", source)
        self.assertIn("reportSections['fire-lot']", source)
        self.assertIn("getReportSnapshot", source)
        self.assertNotIn("filterFireDetectionsToGeometry", source)
        self.assertNotIn("runFullForestAnalysis", source)
        self.assertNotIn("/api/territorial/forest/gfw-drivers/analyze", source)
        self.assertNotIn("fetch(", source)

if __name__ == "__main__":
    unittest.main()
