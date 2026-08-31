"""API request/response schemas — kept separate from the domain vocabulary so
the wire format can evolve independently of the calculation-engine types."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.domain import Band, ComparisonRow, ElementType, RatioResult, Side, SourceFormat, StateKind, Threshold


class ProjectCreateResponse(BaseModel):
    project_id: str


class FileUploadResponse(BaseModel):
    role: str
    filename: str
    detected_format: SourceFormat


class ExtractRequest(BaseModel):
    gabarit: str = "route"  # "route" | "autoroute", default band-labeling template for the DXF heuristic path
    dxf_step_m: float = 5.0


class ExtractResponse(BaseModel):
    axis_confidence: str
    existant_mode: str | None = None
    projet_mode: str | None = None
    bands: list[Band]


class BandOverrideRequest(BaseModel):
    side: Side
    element_type: ElementType


class ThresholdsUpdateRequest(BaseModel):
    thresholds: list[Threshold]
    delta_seuil_m: float


class ThresholdsResponse(BaseModel):
    thresholds: list[Threshold]
    delta_seuil_m: float


class ResultsResponse(BaseModel):
    ratios: list[RatioResult]


class ComparisonResponse(BaseModel):
    rows: list[ComparisonRow]


class DxfExportRequest(BaseModel):
    include_points: bool = True
    include_polylines: bool = True
    include_existant: bool = True
    include_projet: bool = True
    include_ratios: bool = False
    include_comparatif: bool = False
