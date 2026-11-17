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

    def test_no_placeholder_demo_coordinates_or_fake_metrics(self):
        js = (ROOT / "workspace.js").read_text(encoding="utf-8")
        self.assertNotRegex(js, r"(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})")

if __name__ == "__main__":
    unittest.main()
