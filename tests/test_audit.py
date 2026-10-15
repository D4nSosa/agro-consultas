import unittest
import json
import os

class TestComprehensiveAudit(unittest.TestCase):
    def test_cultivos_all_categories_present(self):
        with open("data/cultivos.json", "r", encoding="utf-8") as f:
            cultivos = json.load(f)
        with open("data/forestales.json", "r", encoding="utf-8") as f:
            forestales = json.load(f)

        merged = {**cultivos, **forestales}
        categories = set(c.get("categoria", "") for c in merged.values())
        self.assertTrue(any("Extensivo" in cat for cat in categories))
        self.assertTrue(any("Hortícola" in cat for cat in categories))
        self.assertTrue(any("Frutícola" in cat for cat in categories))
        self.assertTrue(any("Regional" in cat for cat in categories))
        self.assertTrue(any("Forestal" in cat for cat in categories))

    def test_no_simulated_badge_in_html(self):
        for html_file in ["index.html", "resultados.html", "forestal.html"]:
            with open(html_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertNotIn("SIMULADO", content)
            self.assertNotIn("simulado_demo", content)

    def test_data_model_js_structure(self):
        with open("utils/dataModel.js", "r", encoding="utf-8") as f:
            code = f.read()
        self.assertIn("createDataPoint", code)
        self.assertIn("createMetadata", code)
        self.assertIn("createUnavailableDataPoint", code)
        self.assertIn("DataStatus", code)

    def test_ficha_tecnica_7_sections_coverage(self):
        with open("data/cultivos.json", "r", encoding="utf-8") as f:
            cultivos = json.load(f)
        with open("data/forestales.json", "r", encoding="utf-8") as f:
            forestales = json.load(f)

        merged = {**cultivos, **forestales}
        self.assertEqual(len(merged), 44, "Total catalog species count must be exactly 44")

        required_sections = [
            "seccionA_identificacion",
            "seccionB_aptitudTerritorial",
            "seccionC_calendarioFenologia",
            "seccionD_manejoSanidad",
            "seccionE_modelosRendimiento",
            "seccionF_presupuestoEconomico",
            "seccionG_trazabilidadCalidadEvidencia"
        ]

        for key, species in merged.items():
            self.assertIn("fichaTecnica", species, f"Missing fichaTecnica in {key}")
            ft = species["fichaTecnica"]
            for sec in required_sections:
                self.assertIn(sec, ft, f"Missing section {sec} in fichaTecnica for {key}")

if __name__ == "__main__":
    unittest.main()
