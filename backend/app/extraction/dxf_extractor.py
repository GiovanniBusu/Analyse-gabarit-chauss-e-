"""DXF existant/projet extraction.

Two methods, auto-detected (Method B preferred when the DXF declares an
explicit AXE-*/COTE-* layer convention, else Method A, the geometric
heuristic): both ultimately produce Bands + WidthSamples calibrated against
the shared AxisReference built from the mandatory 'Axes + profils' file, so
existant and projet always land on the same PK grid.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict

from app.extraction.axis_reference import AxisReference
from app.extraction.dxf_common import (
    find_legacy_polylines,
    load_document,
    named_axis_and_cote_layers,
    read_texts,
)
from app.extraction.geometry import PolylineIndex, order_lines_by_offset, perpendicular_direction
from app.models.domain import Band, ElementType, Side, SourceMethod, StateKind, WidthSample

ROUTE_TEMPLATE_HALF = [ElementType.ACCOTEMENT, ElementType.TROTTOIR, ElementType.CYCLE, ElementType.VOIE]
AUTOROUTE_TEMPLATE_HALF = [ElementType.ACCOTEMENT, ElementType.BAU, ElementType.VOIE, ElementType.VOIE]

GABARIT_TEMPLATES: dict[str, dict] = {
    "route": {"half": ROUTE_TEMPLATE_HALF, "center": None},
    "autoroute": {"half": AUTOROUTE_TEMPLATE_HALF, "center": ElementType.TPC},
}

_ELEMENT_TOKENS: list[tuple[str, ElementType]] = [
    (r"BAU", ElementType.BAU),
    (r"ACCOT", ElementType.ACCOTEMENT),
    (r"TR.{0,4}OIR", ElementType.TROTTOIR),
    (r"CYCL", ElementType.CYCLE),
    (r"VOIE|CHAUSS", ElementType.VOIE),
    (r"TPC", ElementType.TPC),
]


def detect_mode(doc) -> str:
    return "layers" if named_axis_and_cote_layers(doc) is not None else "heuristic"


def extract_dxf_state(
    path: str,
    state: StateKind,
    axis: AxisReference,
    gabarit: str = "route",
    step_m: float = 5.0,
    band_overrides: dict[str, tuple[Side, ElementType]] | None = None,
) -> tuple[list[Band], list[WidthSample], str]:
    doc = load_document(path)
    mode = detect_mode(doc)
    band_overrides = band_overrides or {}

    if mode == "layers":
        bands, samples = _extract_layer_based(doc, state, axis, band_overrides)
    else:
        bands, samples = _extract_heuristic(doc, state, axis, gabarit, step_m, band_overrides)
    return bands, samples, mode


def _default_band_labels(n_bands: int, gabarit: str) -> list[tuple[Side, ElementType]]:
    template = GABARIT_TEMPLATES.get(gabarit, GABARIT_TEMPLATES["route"])
    half: list[ElementType] = template["half"]
    center: ElementType | None = template["center"]
    expected_no_center = 2 * len(half)

    if center is not None and n_bands == expected_no_center + 1:
        left = [(Side.GAUCHE, t) for t in half]
        right = [(Side.DROITE, t) for t in reversed(half)]
        return left + [(Side.GAUCHE, center)] + right
    if n_bands == expected_no_center:
        left = [(Side.GAUCHE, t) for t in half]
        right = [(Side.DROITE, t) for t in reversed(half)]
        return left + right

    # Band count doesn't match the chosen template: fall back to a neutral
    # split so nothing is silently mislabeled — the user resolves it via the
    # override dropdown in the mapping UI.
    mid = n_bands // 2
    return [(Side.GAUCHE, ElementType.NON_UTILISE)] * mid + [(Side.DROITE, ElementType.NON_UTILISE)] * (n_bands - mid)


def _frange(start: float, stop: float, step: float):
    n = int(math.floor((stop - start) / step + 1e-9)) + 1
    for i in range(n):
        yield start + i * step


def _extract_heuristic(
    doc,
    state: StateKind,
    axis: AxisReference,
    gabarit: str,
    step_m: float,
    band_overrides: dict[str, tuple[Side, ElementType]],
) -> tuple[list[Band], list[WidthSample]]:
    lines = find_legacy_polylines(doc)
    if len(lines) < 2:
        raise ValueError(
            "Heuristic DXF extraction needs at least 2 legacy POLYLINE boundary lines "
            "(LWPOLYLINE fragments are ignored on purpose, see brief)"
        )
    order = order_lines_by_offset(axis.axis, lines)
    ordered_lines = [PolylineIndex.from_points(lines[i]) for i in order]
    n_bands = len(ordered_lines) - 1
    default_labels = _default_band_labels(n_bands, gabarit)
    stations = list(_frange(0.0, axis.axis.length, step_m))

    bands: list[Band] = []
    samples: list[WidthSample] = []
    for band_idx in range(n_bands):
        band_key = f"dxf-{state.value}-band{band_idx}"
        side, element_type = default_labels[band_idx]
        source, confidence = SourceMethod.RECUPERATION_DXF, 0.4
        if band_key in band_overrides:
            side, element_type = band_overrides[band_key]
            source, confidence = SourceMethod.MENU_DEROULANT, 1.0

        widths: list[float] = []
        for s in stations:
            point, direction = axis.axis.point_and_direction_at_station(s)
            perp = perpendicular_direction(direction)
            p1 = ordered_lines[band_idx].intersect_ray(point, perp)
            p2 = ordered_lines[band_idx + 1].intersect_ray(point, perp)
            if p1 is None or p2 is None:
                continue
            width = math.dist(p1, p2)
            pk = axis.station_to_pk(s)
            widths.append(width)
            samples.append(
                WidthSample(pk=pk, side=side, element_type=element_type, state=state, width_m=width, source=source, band_id=band_key)
            )

        bands.append(
            Band(
                band_id=band_key,
                state=state,
                side=side,
                element_type=element_type,
                source=source,
                confidence=confidence,
                label_hint=f"bande géométrique #{band_idx}",
                sample_count=len(widths),
                width_min=min(widths, default=None),
                width_max=max(widths, default=None),
                width_mean=(sum(widths) / len(widths)) if widths else None,
            )
        )
    return bands, samples


def _parse_layer_tokens(name: str) -> tuple[Side, ElementType]:
    upper = name.upper()
    side = Side.DROITE if re.search(r"(?:^|[-_])D(?:$|[-_])|DROITE|S2", upper) else Side.GAUCHE
    element_type = ElementType.NON_UTILISE
    for pattern, et in _ELEMENT_TOKENS:
        if re.search(pattern, upper):
            element_type = et
            break
    return side, element_type


def _extract_layer_based(
    doc,
    state: StateKind,
    axis: AxisReference,
    band_overrides: dict[str, tuple[Side, ElementType]],
) -> tuple[list[Band], list[WidthSample]]:
    layers = named_axis_and_cote_layers(doc)
    cote_layers = set(layers["cote"])
    texts = read_texts(doc)

    by_layer: dict[str, list] = defaultdict(list)
    for t in texts:
        if t.layer in cote_layers:
            by_layer[t.layer].append(t)

    bands: list[Band] = []
    samples: list[WidthSample] = []
    for layer_name, layer_texts in by_layer.items():
        side, element_type = _parse_layer_tokens(layer_name)
        band_key = f"dxf-{state.value}-{layer_name}"
        source, confidence = SourceMethod.RECUPERATION_ENTREES, (1.0 if element_type != ElementType.NON_UTILISE else 0.2)
        if band_key in band_overrides:
            side, element_type = band_overrides[band_key]
            source, confidence = SourceMethod.MENU_DEROULANT, 1.0

        widths: list[float] = []
        for t in layer_texts:
            value = t.numeric_value
            if value is None:
                continue
            pk, _offset = axis.project((t.x, t.y))
            widths.append(value)
            samples.append(
                WidthSample(pk=pk, side=side, element_type=element_type, state=state, width_m=value, source=source, band_id=band_key)
            )

        bands.append(
            Band(
                band_id=band_key,
                state=state,
                side=side,
                element_type=element_type,
                source=source,
                confidence=confidence,
                label_hint=layer_name,
                sample_count=len(widths),
                width_min=min(widths, default=None),
                width_max=max(widths, default=None),
                width_mean=(sum(widths) / len(widths)) if widths else None,
            )
        )
    return bands, samples
