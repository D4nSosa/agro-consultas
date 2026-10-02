import unittest
import json
import os

class TestIntegrityAndTraceability(unittest.TestCase):
    def test_forestales_species_list(self):
        with open('data/forestales.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        self.assertNotIn("forestacion", data)
        self.assertNotIn("Forestacion", data)

    def test_provincias_exists(self):
        with open('data/provincias.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        self.assertIn("misiones", data)
        self.assertIn("corrientes", data)

if __name__ == '__main__':
    unittest.main()
