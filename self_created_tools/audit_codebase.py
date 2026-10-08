import os
import re
import json

ROOT_DIR = "."

KEYWORDS = [
    "fallback", "mock", "demo", "sample", "fake", "simulated",
    "0.1 ha", "1000 m2", "1000", "120", "median = mean", "median: mean"
]

def search_keywords():
    print("=== SEARCHING KEYWORDS AND PATTERNS ===")
    for root, dirs, files in os.walk(ROOT_DIR):
        if any(ignored in root for ignored in [".git", "node_modules", "__pycache__", ".pytest_cache"]):
            continue
        for file in files:
            filepath = os.path.join(root, file)
            if file.endswith((".js", ".py", ".html", ".css", ".json")):
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        lines = f.readlines()
                    for idx, line in enumerate(lines, 1):
                        for kw in KEYWORDS:
                            if kw.lower() in line.lower():
                                print(f"{filepath}:{idx} [{kw}] -> {line.strip()[:100]}")
                except Exception as e:
                    pass

def check_json_datasets():
    print("\n=== CHECKING JSON DATASETS ===")
    for fpath in ["data/cultivos.json", "data/forestales.json", "data/provincias.json", "data/regiones.json"]:
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    print(f"{fpath}: List of {len(data)} items")
                    if len(data) > 0:
                        print(" Sample keys:", list(data[0].keys()))
                elif isinstance(data, dict):
                    print(f"{fpath}: Dict with keys {list(data.keys())}")

if __name__ == "__main__":
    search_keywords()
    check_json_datasets()
