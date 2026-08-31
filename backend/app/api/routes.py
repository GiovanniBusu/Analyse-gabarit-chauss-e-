from __future__ import annotations

import io

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api.pipeline import run_extraction
from app.api.store import ROLES, UploadedFile, detect_format, store
from app.calculations.comparison import compare_states
from app.calculations.ratios import compute_ratios
from app.export.dxf_export import DxfExportOptions, build_dxf
from app.export.excel_export import build_workbook
from app.models.domain import StateKind
from app.models.schemas import (
    BandOverrideRequest,
    ComparisonResponse,
    DxfExportRequest,
    ExtractRequest,
    ExtractResponse,
    FileUploadResponse,
    ProjectCreateResponse,
    ResultsResponse,
    ThresholdsResponse,
    ThresholdsUpdateRequest,
)

router = APIRouter(prefix="/api/projects")


def _get_project(project_id: str):
    try:
        return store.get(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Projet introuvable")


@router.post("", response_model=ProjectCreateResponse)
def create_project():
    project = store.create()
    return ProjectCreateResponse(project_id=project.project_id)


@router.post("/{project_id}/files/{role}", response_model=FileUploadResponse)
async def upload_file(project_id: str, role: str, file: UploadFile = File(...)):
    project = _get_project(project_id)
    if role not in ROLES:
        raise HTTPException(status_code=400, detail=f"role doit être l'un de {ROLES}")
    try:
        fmt = detect_format(file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    dest = project.work_dir / f"{role}_{file.filename}"
    content = await file.read()
    dest.write_bytes(content)
    project.files[role] = UploadedFile(path=str(dest), filename=file.filename, fmt=fmt)
    return FileUploadResponse(role=role, filename=file.filename, detected_format=fmt)


@router.post("/{project_id}/extract", response_model=ExtractResponse)
def extract(project_id: str, body: ExtractRequest):
    project = _get_project(project_id)
    if not project.is_ready_to_extract():
        missing = [r for r in ROLES if r not in project.files]
        raise HTTPException(status_code=400, detail=f"Fichiers manquants: {missing}")
    project.gabarit = body.gabarit
    project.dxf_step_m = body.dxf_step_m
    try:
        run_extraction(project)
    except Exception as exc:  # extraction failures are user-facing (bad file), not server errors
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ExtractResponse(
        axis_confidence=project.axis.confidence,
        existant_mode=project.existant_mode,
        projet_mode=project.projet_mode,
        bands=list(project.bands.values()),
    )


@router.get("/{project_id}/bands")
def get_bands(project_id: str):
    project = _get_project(project_id)
    return list(project.bands.values())


@router.patch("/{project_id}/bands/{band_id}")
def override_band(project_id: str, band_id: str, body: BandOverrideRequest):
    project = _get_project(project_id)
    if band_id not in project.bands:
        raise HTTPException(status_code=404, detail="Bande introuvable")
    project.overrides[band_id] = (body.side, body.element_type)
    try:
        run_extraction(project)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return list(project.bands.values())


@router.get("/{project_id}/thresholds", response_model=ThresholdsResponse)
def get_thresholds(project_id: str):
    project = _get_project(project_id)
    return ThresholdsResponse(thresholds=project.thresholds, delta_seuil_m=project.delta_seuil_m)


@router.put("/{project_id}/thresholds", response_model=ThresholdsResponse)
def update_thresholds(project_id: str, body: ThresholdsUpdateRequest):
    project = _get_project(project_id)
    project.thresholds = body.thresholds
    project.delta_seuil_m = body.delta_seuil_m
    return ThresholdsResponse(thresholds=project.thresholds, delta_seuil_m=project.delta_seuil_m)


@router.get("/{project_id}/results", response_model=ResultsResponse)
def get_results(project_id: str):
    project = _get_project(project_id)
    ratios = compute_ratios(project.samples, project.thresholds)
    return ResultsResponse(ratios=ratios)


@router.get("/{project_id}/comparison", response_model=ComparisonResponse)
def get_comparison(project_id: str):
    project = _get_project(project_id)
    rows = compare_states(project.samples, project.delta_seuil_m)
    return ComparisonResponse(rows=rows)


@router.get("/{project_id}/export/excel")
def export_excel(project_id: str):
    project = _get_project(project_id)
    comparison = compare_states(project.samples, project.delta_seuil_m) if project.samples else []
    wb = build_workbook(project.samples, project.thresholds, project.delta_seuil_m, comparison)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=analyse_gabarit.xlsx"},
    )


@router.post("/{project_id}/export/dxf")
def export_dxf(project_id: str, body: DxfExportRequest):
    project = _get_project(project_id)
    comparison = compare_states(project.samples, project.delta_seuil_m) if project.samples else []
    options = DxfExportOptions(**body.model_dump())
    doc = build_dxf(project.samples, project.thresholds, comparison, options)
    buf = io.StringIO()
    doc.write(buf)
    byte_buf = io.BytesIO(buf.getvalue().encode("utf-8"))
    return StreamingResponse(
        byte_buf,
        media_type="application/dxf",
        headers={"Content-Disposition": "attachment; filename=analyse_gabarit.dxf"},
    )
