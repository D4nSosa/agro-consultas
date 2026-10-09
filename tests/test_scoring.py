import unittest
import json

class TestScoringAndDataModel(unittest.TestCase):
    def test_crop_dataset_structure(self):
        with open("data/cultivos.json", "r", encoding="utf-8") as f:
            cultivos = json.load(f)
        with open("data/forestales.json", "r", encoding="utf-8") as f:
            forestales = json.load(f)

        merged = {**cultivos, **forestales}

        self.assertIn("trigo", merged)
        self.assertIn("soja", merged)
        self.assertIn("maiz", merged)
        self.assertIn("yerba mate", merged)
        self.assertIn("limon", merged)
        self.assertIn("pino taeda", merged)

        for name, data in merged.items():
            self.assertIn("requerimientos", data)
            self.assertIn("suelo", data["requerimientos"])
            self.assertIn("clima", data["requerimientos"])

    def test_provincias_dataset_structure(self):
        with open("data/provincias.json", "r", encoding="utf-8") as f:
            provincias = json.load(f)

        self.assertIn("misiones", provincias)
        self.assertIn("buenos aires", provincias)
        self.assertIn("cordoba", provincias)

        for p_name, p_data in provincias.items():
            self.assertIn("nombre", p_data)
            self.assertIn("cultivos", p_data["nombre"])
            self.assertTrue(len(p_data["nombre"]["cultivos"]) > 0)

if __name__ == "__main__":
    unittest.main()
