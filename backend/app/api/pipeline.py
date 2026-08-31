"""Stateless extraction pipeline: given the 3 uploaded files (paths already on
disk) and a couple of options, run the whole DXF/IFC extraction once and
return everything the caller needs. No server-side session is kept — the
caller (the API layer) owns the temp files for the duration of one request
and the response carries the full result."""

from __future__ import annotations

from app.extraction.axis_reference import AxisReference, build_axis_reference_from_dxf, build_axis_reference_from_ifc
from app.extraction.dxf_extractor import extract_dxf_state
from app.extraction.ifc_extractor import extract_ifc_state
from app.models.domain import Band, SourceFormat, StateKind, WidthSample


def _extract_state(path: str, fmt: SourceFormat, state: StateKind, axis: AxisReference, gabarit: str, dxf_step_m: float):
    if fmt == SourceFormat.DXF:
        bands, samples, mode = extract_dxf_state(path, state, axis, gabarit=gabarit, step_m=dxf_step_m)
        return bands, samples, mode
    bands, samples = extract_ifc_state(path, state, axis)
    return bands, samples, "ifc"


def run_extraction(
    axis_path: str,
    axis_fmt: SourceFormat,
    existant_path: str,
    existant_fmt: SourceFormat,
    projet_path: str,
    projet_fmt: SourceFormat,
    gabarit: str,
    dxf_step_m: float,
) -> tuple[AxisReference, list[Band], list[WidthSample], str, str]:
    if axis_fmt == SourceFormat.DXF:
        axis = build_axis_reference_from_dxf(axis_path)
    else:
        axis = build_axis_reference_from_ifc(axis_path)

    existant_bands, existant_samples, existant_mode = _extract_state(
        existant_path, existant_fmt, StateKind.EXISTANT, axis, gabarit, dxf_step_m
    )
    projet_bands, projet_samples, projet_mode = _extract_state(
        projet_path, projet_fmt, StateKind.PROJET, axis, gabarit, dxf_step_m
    )

    bands = existant_bands + projet_bands
    samples = existant_samples + projet_samples
    return axis, bands, samples, existant_mode, projet_mode
