import io

import ezdxf
import openpyxl
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_full_pipeline_via_api(three_file_project):
    files = {}
    for role, path in three_file_project.items():
        files[role] = (f"{role}.dxf", open(path, "rb"), "application/dxf")

    r = client.post(
        "/api/extract",
        files=files,
        data={"gabarit": "route", "dxf_step_m": "10.0"},
    )
    for _role, (_name, fh, _ct) in files.items():
        fh.close()
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["bands"]) == 4  # 2 bands x 2 states
    assert len(body["samples"]) > 0
    assert body["axis_confidence"] == "profile_markers"

    # Manual override happens client-side in the real app; here we just
    # simulate it the way the frontend would before calling export.
    band_id = body["bands"][0]["band_id"]
    samples = body["samples"]
    for s in samples:
        if s["band_id"] == band_id:
            s["side"] = "gauche"
            s["element_type"] = "voie"

    default_thresholds = [
        {"element_type": "bau", "reduit_m": 2.5, "standard_m": 3.25},
        {"element_type": "voie", "reduit_m": 7.5, "standard_m": 8.0},
        {"element_type": "accotement", "reduit_m": 1.0, "standard_m": 2.5},
        {"element_type": "trottoir", "reduit_m": 1.5, "standard_m": 2.0},
        {"element_type": "cycle", "reduit_m": 1.5, "standard_m": 2.0},
        {"element_type": "tpc", "reduit_m": 1.0, "standard_m": 3.0},
    ]

    r = client.post(
        "/api/export/excel",
        json={"samples": samples, "thresholds": default_thresholds, "delta_seuil_m": 0.05, "comparison": []},
    )
    assert r.status_code == 200, r.text
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert {"Données", "Seuils", "Résultats"}.issubset(set(wb.sheetnames))

    r = client.post(
        "/api/export/dxf",
        json={
            "samples": samples,
            "thresholds": default_thresholds,
            "delta_seuil_m": 0.05,
            "comparison": [],
            "include_points": True,
            "include_polylines": True,
        },
    )
    assert r.status_code == 200, r.text
    doc = ezdxf.read(io.StringIO(r.content.decode("utf-8")))
    assert len(list(doc.layers)) > 0


def test_extract_rejects_unsupported_extension(tmp_path):
    bogus = tmp_path / "not_a_cad_file.txt"
    bogus.write_text("hello")
    with open(bogus, "rb") as fh:
        r = client.post(
            "/api/extract",
            files={
                "axes_profils": ("axes.txt", fh, "text/plain"),
                "existant": ("existant.txt", open(bogus, "rb"), "text/plain"),
                "projet": ("projet.txt", open(bogus, "rb"), "text/plain"),
            },
            data={"gabarit": "route", "dxf_step_m": "10.0"},
        )
    assert r.status_code == 400
