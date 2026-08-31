import ezdxf
import openpyxl
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_full_pipeline_via_api(three_file_project):
    r = client.post("/api/projects")
    assert r.status_code == 200
    project_id = r.json()["project_id"]

    for role, path in three_file_project.items():
        with open(path, "rb") as fh:
            r = client.post(
                f"/api/projects/{project_id}/files/{role}",
                files={"file": (f"{role}.dxf", fh, "application/dxf")},
            )
        assert r.status_code == 200, r.text
        assert r.json()["detected_format"] == "dxf"

    r = client.post(f"/api/projects/{project_id}/extract", json={"gabarit": "route", "dxf_step_m": 10.0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["bands"]) == 4  # 2 bands x 2 states
    band_id = body["bands"][0]["band_id"]

    r = client.patch(
        f"/api/projects/{project_id}/bands/{band_id}",
        json={"side": "gauche", "element_type": "voie"},
    )
    assert r.status_code == 200, r.text
    overridden = next(b for b in r.json() if b["band_id"] == band_id)
    assert overridden["element_type"] == "voie"
    assert overridden["source"] == "menu_deroulant"

    r = client.get(f"/api/projects/{project_id}/results")
    assert r.status_code == 200
    assert len(r.json()["ratios"]) > 0

    r = client.get(f"/api/projects/{project_id}/comparison")
    assert r.status_code == 200
    assert len(r.json()["rows"]) > 0

    r = client.get(f"/api/projects/{project_id}/export/excel")
    assert r.status_code == 200
    wb = openpyxl.load_workbook(__import__("io").BytesIO(r.content))
    assert set(["Données", "Seuils", "Résultats", "Comparatif"]).issubset(set(wb.sheetnames))

    r = client.post(
        f"/api/projects/{project_id}/export/dxf",
        json={"include_points": True, "include_polylines": True, "include_comparatif": True, "include_ratios": True},
    )
    assert r.status_code == 200
    doc = ezdxf.read(__import__("io").StringIO(r.content.decode("utf-8")))
    assert len(list(doc.layers)) > 0


def test_extract_requires_all_three_files():
    r = client.post("/api/projects")
    project_id = r.json()["project_id"]
    r = client.post(f"/api/projects/{project_id}/extract", json={})
    assert r.status_code == 400
