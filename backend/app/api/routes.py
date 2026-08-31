from __future__ import annotations

import io
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api.pipeline import run_extraction
from app.api.store import detect_format
from app.export.dxf_export import DxfExportOptions, build_dxf
from app.export.excel_export import build_workbook
from app.models.schemas import DxfExportRequest, ExcelExportRequest, ExtractResponse, FileUploadInfo

router = APIRouter(prefix="/api")


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    axes_profils: UploadFile = File(...),
    existant: UploadFile = File(...),
    projet: UploadFile = File(...),
    gabarit: str = Form("route"),
    dxf_step_m: float = Form(5.0),
):
    uploads = {"axes_profils": axes_profils, "existant": existant, "projet": projet}
    formats: dict[str, FileUploadInfo] = {}
    for role, upload in uploads.items():
        try:
            fmt = detect_format(upload.filename)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        formats[role] = FileUploadInfo(filename=upload.filename, detected_format=fmt)

    with tempfile.TemporaryDirectory(prefix="gabarit_") as tmp:
        paths: dict[str, str] = {}
        for role, upload in uploads.items():
            dest = Path(tmp) / f"{role}_{upload.filename}"
            dest.write_bytes(await upload.read())
            paths[role] = str(dest)

        try:
            axis, bands, samples, existant_mode, projet_mode = run_extraction(
                paths["axes_profils"],
                formats["axes_profils"].detected_format,
                paths["existant"],
                formats["existant"].detected_format,
                paths["projet"],
                formats["projet"].detected_format,
                gabarit,
                dxf_step_m,
            )
        except Exception as exc:  # extraction failures are user-facing (bad file), not server errors
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ExtractResponse(
        axis_confidence=axis.confidence,
        existant_mode=existant_mode,
        projet_mode=projet_mode,
        bands=bands,
        samples=samples,
        files=formats,
    )


@router.post("/export/excel")
def export_excel(body: ExcelExportRequest):
    wb = build_workbook(body.samples, body.thresholds, body.delta_seuil_m, body.comparison)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=analyse_gabarit.xlsx"},
    )


@router.post("/export/dxf")
def export_dxf(body: DxfExportRequest):
    options = DxfExportOptions(
        include_points=body.include_points,
        include_polylines=body.include_polylines,
        include_existant=body.include_existant,
        include_projet=body.include_projet,
        include_ratios=body.include_ratios,
        include_comparatif=body.include_comparatif,
    )
    doc = build_dxf(body.samples, body.thresholds, body.comparison, options)
    buf = io.StringIO()
    doc.write(buf)
    byte_buf = io.BytesIO(buf.getvalue().encode("utf-8"))
    return StreamingResponse(
        byte_buf,
        media_type="application/dxf",
        headers={"Content-Disposition": "attachment; filename=analyse_gabarit.dxf"},
    )
