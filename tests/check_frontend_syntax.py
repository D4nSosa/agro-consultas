from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FILES = ["script.js", "services/lotContext.js", "services/fireMonitoringService.mjs"]
INLINE_HTML = ["mapa.html", "tracking.html", "forestal.html", "resultados.html", "incendios.html"]

def check_module(source: str, label: str) -> None:
    result = subprocess.run(
        ["node", "--check", "--input-type=module"],
        input=source,
        text=True,
        capture_output=True,
    )
    if result.returncode:
        raise SystemExit(f"JavaScript syntax error in {label}:\n{result.stderr}")

for relative in FILES:
    check_module((ROOT / relative).read_text(encoding="utf-8"), relative)

for relative in INLINE_HTML:
    html = (ROOT / relative).read_text(encoding="utf-8")
    blocks = re.findall(r'<script\s+type="module">(.*?)</script>', html, flags=re.I | re.S)
    for index, block in enumerate(blocks, start=1):
        check_module(block, f"{relative} inline module #{index}")

print("Frontend module syntax checks passed.")
