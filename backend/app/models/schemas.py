"""API request/response schemas.

The API is stateless: after /extract returns bands + samples, every other
operation (override, ratios, comparison) happens client-side, and export
endpoints simply take the current samples/thresholds/comparison as input.
This was a deliberate fix, not just a workaround for one host: a server that
keeps per-session state in memory loses it on any process restart, which
free-tier hosts (Render included) do routinely on idle timeout — a stateless
API has no such failure mode on any host.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.models.domain import Band, ComparisonRow, SourceFormat, Threshold, WidthSample


class FileUploadInfo(BaseModel):
    filename: str
    detected_format: SourceFormat


class ExtractResponse(BaseModel):
    axis_confidence: str
    existant_mode: str
    projet_mode: str
    bands: list[Band]
    samples: list[WidthSample]
    files: dict[str, FileUploadInfo]


class DxfExportRequest(BaseModel):
    samples: list[WidthSample]
    thresholds: list[Threshold]
    delta_seuil_m: float
    comparison: list[ComparisonRow] = []
    include_points: bool = True
    include_polylines: bool = True
    include_existant: bool = True
    include_projet: bool = True
    include_ratios: bool = False
    include_comparatif: bool = False


class ExcelExportRequest(BaseModel):
    samples: list[WidthSample]
    thresholds: list[Threshold]
    delta_seuil_m: float
    comparison: list[ComparisonRow] = []
