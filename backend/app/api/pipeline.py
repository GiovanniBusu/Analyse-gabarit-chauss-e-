"""Ties the extraction modules together against one ProjectState: builds the
shared axis reference from the mandatory 'Axes + profils' file, then runs the
DXF or IFC extractor (auto-selected by file format) for existant and projet,
merging in any user overrides collected so far."""

from __future__ import annotations

from app.api.store import ProjectState
from app.extraction.axis_reference import build_axis_reference_from_dxf, build_axis_reference_from_ifc
from app.extraction.dxf_extractor import extract_dxf_state
from app.extraction.ifc_extractor import extract_ifc_state
from app.models.domain import Band, SourceFormat, StateKind, WidthSample


def _extract_state(project: ProjectState, role: str, state: StateKind) -> tuple[list[Band], list[WidthSample], str]:
    uploaded = project.files[role]
    if uploaded.fmt == SourceFormat.DXF:
        bands, samples, mode = extract_dxf_state(
            uploaded.path,
            state,
            project.axis,
            gabarit=project.gabarit,
            step_m=project.dxf_step_m,
            band_overrides=project.overrides,
        )
        return bands, samples, mode
    bands, samples = extract_ifc_state(uploaded.path, state, project.axis, type_mapping=project.overrides)
    return bands, samples, "ifc"


def run_extraction(project: ProjectState) -> None:
    if not project.is_ready_to_extract():
        raise ValueError("Les 3 fichiers obligatoires (axes+profils, existant, projet) doivent être chargés")

    axis_file = project.files["axes_profils"]
    if axis_file.fmt == SourceFormat.DXF:
        project.axis = build_axis_reference_from_dxf(axis_file.path)
    else:
        project.axis = build_axis_reference_from_ifc(axis_file.path)

    existant_bands, existant_samples, existant_mode = _extract_state(project, "existant", StateKind.EXISTANT)
    projet_bands, projet_samples, projet_mode = _extract_state(project, "projet", StateKind.PROJET)

    project.bands = {b.band_id: b for b in existant_bands + projet_bands}
    project.samples = existant_samples + projet_samples
    project.existant_mode = existant_mode
    project.projet_mode = projet_mode
