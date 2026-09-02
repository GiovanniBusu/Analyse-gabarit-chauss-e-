"""DXF export: a schematic width-vs-PK chart (X = PK in metres, Y = width in
metres), structured into layers by Existant/Projet/Ratios/Comparatif so the
user can toggle each family on/off in their CAD viewer. POINT and/or
LWPOLYLINE representation is selectable per the export options.

This does not attempt to reconstruct true plan-view corridor geometry: the
pipeline's internal representation from this point on is scalar width samples
(pk, width), not boundary curves, so a faithful geometric re-export is out of
scope — the value here is a structured, layered, re-importable record of the
measurements and their compliance/comparison classification.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import ezdxf

from app.models.domain import ComparisonRow, ComparisonStatus, ElementType, Side, StateKind, Threshold, WidthSample

_SIDE_TAG = {Side.GAUCHE: "G", Side.DROITE: "D"}
_TYPE_TAG = {
    ElementType.NON_UTILISE: "NON_UTILISE",
    ElementType.ACCOTEMENT: "ACCOTEMENT",
    ElementType.TROTTOIR: "TROTTOIR",
    ElementType.BAU: "BAU",
    ElementType.CYCLE: "CYCLE",
    ElementType.VOIE: "VOIE",
    ElementType.TPC: "TPC",
}
_STATE_TAG = {StateKind.EXISTANT: "EXISTANT", StateKind.PROJET: "PROJET"}

_ACI_RATIO_SOUS_REDUIT = 1  # red
_ACI_RATIO_ENTRE = 2  # yellow
_ACI_RATIO_STANDARD = 3  # green
_ACI_STATUS = {
    ComparisonStatus.AMELIORE: 3,  # green
    ComparisonStatus.DEGRADE: 1,  # red
    ComparisonStatus.INCHANGE: 8,  # gray
}

# Distinct color per (état, côté) combination -- coloring by état alone made
# gauche and droite series render identically, so the two sides couldn't be
# told apart in a DXF viewer even though the layers are named separately.
_SERIES_COLOR = {
    StateKind.EXISTANT: {Side.GAUCHE: 5, Side.DROITE: 4},  # blue / cyan
    StateKind.PROJET: {Side.GAUCHE: 3, Side.DROITE: 2},  # green / yellow
}


@dataclass
class DxfExportOptions:
    include_points: bool = True
    include_polylines: bool = True
    include_existant: bool = True
    include_projet: bool = True
    include_ratios: bool = False
    include_comparatif: bool = False


def _ensure_layer(doc, name: str, color: int = 7) -> str:
    safe = name.replace(" ", "_")
    if safe not in doc.layers:
        doc.layers.add(safe, color=color)
    return safe


def _draw_series(msp, layer: str, points: list[tuple[float, float]], color: int, opts: DxfExportOptions) -> None:
    if not points:
        return
    if opts.include_points:
        for x, y in points:
            msp.add_point((x, y), dxfattribs={"layer": layer, "color": color})
    if opts.include_polylines and len(points) >= 2:
        ordered = sorted(points, key=lambda p: p[0])
        msp.add_lwpolyline(ordered, dxfattribs={"layer": layer, "color": color})


def build_dxf(
    samples: list[WidthSample],
    thresholds: list[Threshold],
    comparison_rows: list[ComparisonRow] | None,
    options: DxfExportOptions,
) -> "ezdxf.document.Drawing":
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    if options.include_existant or options.include_projet:
        by_group: dict[tuple[Side, ElementType, StateKind], list[tuple[float, float]]] = defaultdict(list)
        for s in samples:
            if s.width_m is None:
                continue
            if s.state == StateKind.EXISTANT and not options.include_existant:
                continue
            if s.state == StateKind.PROJET and not options.include_projet:
                continue
            by_group[(s.side, s.element_type, s.state)].append((s.pk, s.width_m))
        for (side, element_type, state), points in by_group.items():
            color = _SERIES_COLOR[state][side]
            layer = _ensure_layer(doc, f"{_STATE_TAG[state]}_{_SIDE_TAG[side]}_{_TYPE_TAG[element_type]}", color=color)
            _draw_series(msp, layer, points, color, options)

    if options.include_ratios:
        threshold_by_type = {t.element_type: t for t in thresholds}
        for s in samples:
            if s.width_m is None:
                continue
            threshold = threshold_by_type.get(s.element_type)
            if threshold is None:
                continue
            if s.width_m < threshold.reduit_m:
                color = _ACI_RATIO_SOUS_REDUIT
            elif s.width_m < threshold.standard_m:
                color = _ACI_RATIO_ENTRE
            else:
                color = _ACI_RATIO_STANDARD
            layer = _ensure_layer(
                doc, f"RATIOS_{_STATE_TAG[s.state]}_{_SIDE_TAG[s.side]}_{_TYPE_TAG[s.element_type]}"
            )
            if options.include_points:
                msp.add_point((s.pk, s.width_m), dxfattribs={"layer": layer, "color": color})

    if options.include_comparatif and comparison_rows:
        by_group_status: dict[tuple[Side, ElementType], list[tuple[float, float, int]]] = defaultdict(list)
        for row in comparison_rows:
            if row.delta is None or row.status is None:
                continue
            by_group_status[(row.side, row.element_type)].append((row.pk, row.delta, _ACI_STATUS[row.status]))
        for (side, element_type), triples in by_group_status.items():
            layer = _ensure_layer(doc, f"COMPARATIF_{_SIDE_TAG[side]}_{_TYPE_TAG[element_type]}")
            if options.include_points:
                for pk, delta, color in triples:
                    msp.add_point((pk, delta), dxfattribs={"layer": layer, "color": color})
            if options.include_polylines and len(triples) >= 2:
                ordered = sorted(triples, key=lambda t: t[0])
                msp.add_lwpolyline([(pk, delta) for pk, delta, _c in ordered], dxfattribs={"layer": layer, "color": 7})

    return doc
