import json
import os
import sys

def validate():
    cultivos_path = "data/cultivos.json"
    provincias_path = "data/provincias.json"
    forestales_path = "data/forestales.json"

    with open(cultivos_path, "r", encoding="utf-8") as f:
        cultivos = json.load(f)

    with open(provincias_path, "r", encoding="utf-8") as f:
        provincias = json.load(f)

    with open(forestales_path, "r", encoding="utf-8") as f:
        forestales = json.load(f)

    print(f"Loaded {len(cultivos)} crops from {cultivos_path}")
    print(f"Loaded {len(provincias)} provinces from {provincias_path}")
    print(f"Loaded {len(forestales)} forestry species from {forestales_path}")

    required_keys = ["descripcion", "siembra", "cosecha", "reqSuelo", "reqClima", "requerimientos"]
    for crop_name, crop_data in cultivos.items():
        for k in required_keys:
            if k not in crop_data:
                print(f"Error: Crop '{crop_name}' missing field '{k}'")
                sys.exit(1)
        reqs = crop_data["requerimientos"]
        if "suelo" not in reqs or "clima" not in reqs:
            print(f"Error: Crop '{crop_name}' missing soil or climate requirements")
            sys.exit(1)

    print("All dataset validations passed successfully!")

if __name__ == "__main__":
    validate()
