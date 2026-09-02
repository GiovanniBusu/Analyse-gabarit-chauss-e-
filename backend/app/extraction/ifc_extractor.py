"""IfcRoad -> IfcRoadPart -> IfcPavement traversal and width extraction.

Per the brief: IfcPavementType names are user-defined and can be misleading, so
this module only ever *suggests* a (side, element_type) mapping — confidence is
kept low and the caller (API layer) always exposes the suggestion for user
confirmation via the same override mechanism used for DXF bands.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import ifcopenshell

from app.extraction.axis_reference import AxisReference
from app.extraction.ifc_geometry import pavement_width_samples
from app.models.domain import Band, ElementType, Side, SourceMethod, StateKind, WidthSample

_KEYWORD_HINTS: list[tuple[str, ElementType]] = [
    (r"bau", ElementType.BAU),
    (r"accot", ElementType.ACCOTEMENT),
    (r"tr.{0,4}oir", ElementType.TROTTOIR),
    (r"cycl", ElementType.CYCLE),
    (r"voie|chauss", ElementType.VOIE),
    (r"tpc|median|terre.?plein", ElementType.TPC),
]


def guess_element_type(type_name: str) -> tuple[ElementType, float]:
    """Best-effort keyword guess from the IFC type name. Deliberately low
    confidence: the brief documents a real case where a type named 'Trotoir'
    actually represented the carriageway, so this is a suggestion only."""
    name = type_name.lower()
    for pattern, element_type in _KEYWORD_HINTS:
        if re.search(pattern, name):
            return element_type, 0.3
    return ElementType.NON_UTILISE, 0.1


@dataclass
class PavementGroup:
    type_name: str
    side: Side
    products: list = field(default_factory=list)


def _pavement_type_name(pavement) -> str:
    for rel in getattr(pavement, "IsTypedBy", []) or []:
        rel_type = rel.RelatingType
        if rel_type is not None:
            return rel_type.Name or rel_type.is_a()
    return pavement.Name or f"Pavement-{pavement.id()}"


def _road_ancestor_name(pavement) -> str | None:
    current = pavement
    for _ in range(6):
        rels = getattr(current, "Decomposes", []) or []
        if not rels:
            return None
        parent = rels[0].RelatingObject
        if parent.is_a("IfcRoad"):
            return parent.Name
        current = parent
    return None


def _matches_state(name: str | None, state: StateKind) -> bool:
    if name is None:
        return True
    lowered = name.lower()
    if state == StateKind.EXISTANT:
        return any(k in lowered for k in ("exist", "actuel"))
    return any(k in lowered for k in ("projet", "project", "futur"))


def list_pavement_groups(ifc, state: StateKind, axis: AxisReference) -> list[PavementGroup]:
    """Groups by (type name, côté) rather than type name alone: a real IFC
    export typically gives both lanes of a road the same IfcPavementType
    (e.g. a single "Voie" type used on both sides), so grouping by type name
    only would merge the left and right pavements into one band and force a
    single side label onto their combined geometry -- losing one side
    entirely. Side is guessed per individual pavement product, before
    grouping, so left and right stay distinct bands even when they share a
    type name."""
    pavements = ifc.by_type("IfcPavement")
    road_names = {p.id(): _road_ancestor_name(p) for p in pavements}
    has_dual_state = any(_matches_state(n, StateKind.EXISTANT) != _matches_state(n, StateKind.PROJET) and n for n in road_names.values())

    groups: dict[tuple[str, Side], PavementGroup] = {}
    for p in pavements:
        if has_dual_state and not _matches_state(road_names[p.id()], state):
            continue
        type_name = _pavement_type_name(p)
        side = _guess_side([p], axis)
        key = (type_name, side)
        groups.setdefault(key, PavementGroup(type_name=type_name, side=side)).products.append(p)
    return list(groups.values())


def _guess_side(products, axis: AxisReference) -> Side:
    offsets = []
    for p in products:
        from app.extraction.ifc_geometry import shape_vertices

        verts = shape_vertices(p)
        if verts is None:
            continue
        offsets.extend(axis.axis.project_point((v[0], v[1]))[1] for v in verts[:: max(1, len(verts) // 50)])
    mean_offset = float(np.mean(offsets)) if offsets else 0.0
    return Side.GAUCHE if mean_offset >= 0 else Side.DROITE


def extract_ifc_state(
    path: str,
    state: StateKind,
    axis: AxisReference,
    type_mapping: dict[str, tuple[Side, ElementType]] | None = None,
) -> tuple[list[Band], list[WidthSample]]:
    """`type_mapping` is keyed by band_id (stable: f"ifc-{state}-{slug(type_name)}"),
    matching the same override mechanism used for DXF bands."""
    ifc = ifcopenshell.open(path)
    type_mapping = type_mapping or {}
    groups = list_pavement_groups(ifc, state, axis)

    bands: list[Band] = []
    samples: list[WidthSample] = []
    for group in groups:
        slug = re.sub(r"[^a-z0-9]+", "_", group.type_name.lower()).strip("_")
        band_id = f"ifc-{state.value}-{slug}-{group.side.value}"
        side = group.side
        if band_id in type_mapping:
            side, element_type = type_mapping[band_id]
            source = SourceMethod.RECUPERATION_ENTREES
            confidence = 1.0
        else:
            element_type, confidence = guess_element_type(group.type_name)
            source = SourceMethod.RECUPERATION_DXF

        widths: list[tuple[float, float]] = []
        for product in group.products:
            widths.extend(pavement_width_samples(product, axis))

        band = Band(
            band_id=band_id,
            state=state,
            side=side,
            element_type=element_type,
            source=source,
            confidence=confidence,
            label_hint=group.type_name,
            sample_count=len(widths),
            width_min=min((w for _, w in widths), default=None),
            width_max=max((w for _, w in widths), default=None),
            width_mean=(sum(w for _, w in widths) / len(widths)) if widths else None,
        )
        bands.append(band)
        for pk, width in widths:
            samples.append(
                WidthSample(
                    pk=pk,
                    side=side,
                    element_type=element_type,
                    state=state,
                    width_m=width,
                    source=source,
                    band_id=band_id,
                )
            )
    return bands, samples
