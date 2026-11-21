"""Runs live public-source smoke checks inside the existing pytest GitHub Actions job."""
import json
from pathlib import Path
import runpy


def test_live_public_source_smoke_report_is_generated():
    script_path = Path(__file__).with_name("live_source_smoke.py")
    module = runpy.run_path(str(script_path), run_name="agro_consultas_live_smoke")
    module["main"]()

    report_path = Path(__file__).resolve().parents[1] / "artifacts" / "live-source-smoke.json"
    assert report_path.is_file()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["national_admin_catalog"]["matches_expected"] is True
    assert len(report["checks"]["stac_provincial_samples"]) == 24
    assert "conae" in report["checks"]
    assert "inta_wms" in report["checks"]
