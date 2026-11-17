from pathlib import Path
import re
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

    def test_report_uses_a_geometry_centroid_and_explains_its_source(self):
        html = (ROOT / "reporte.html").read_text(encoding="utf-8")
        self.assertIn("calculateCentroid(parsedGeom)", html)
        self.assertIn("report-coords-method", html)
        self.assertNotIn("getBounds().getCenter()", html)

if __name__ == "__main__":
    unittest.main()
