"""Existant vs projet comparison at matching PK, interpolating the projet
width when stations don't coincide exactly."""

from __future__ import annotations

import bisect
from collections import defaultdict

from app.models.domain import ComparisonRow, ComparisonStatus, ElementType, Side, StateKind, WidthSample


def _interpolate(pk: float, pks: list[float], widths: list[float]) -> float | None:
    if not pks:
        return None
    idx = bisect.bisect_left(pks, pk)
    if idx == 0:
        return widths[0] if pks[0] - pk < 1e-6 else None
    if idx >= len(pks):
        return widths[-1] if pk - pks[-1] < 1e-6 else None
    if pks[idx] == pk:
        return widths[idx]
    pk0, pk1 = pks[idx - 1], pks[idx]
    w0, w1 = widths[idx - 1], widths[idx]
    if pk1 == pk0:
        return w0
    t = (pk - pk0) / (pk1 - pk0)
    return w0 + t * (w1 - w0)


def compare_states(samples: list[WidthSample], delta_seuil_m: float) -> list[ComparisonRow]:
    by_group: dict[tuple[Side, ElementType, StateKind], list[WidthSample]] = defaultdict(list)
    for s in samples:
        if s.width_m is not None:
            by_group[(s.side, s.element_type, s.state)].append(s)

    keys = {(side, et) for (side, et, _state) in by_group}
    rows: list[ComparisonRow] = []
    for side, element_type in sorted(keys, key=lambda k: (k[0].value, k[1].value)):
        existant = sorted(by_group.get((side, element_type, StateKind.EXISTANT), []), key=lambda s: s.pk)
        projet = sorted(by_group.get((side, element_type, StateKind.PROJET), []), key=lambda s: s.pk)
        if not existant and not projet:
            continue
        projet_pks = [s.pk for s in projet]
        projet_widths = [s.width_m for s in projet]
        existant_pks = [s.pk for s in existant]
        existant_widths = [s.width_m for s in existant]

        all_pks = sorted({s.pk for s in existant} | {s.pk for s in projet})
        for pk in all_pks:
            w_exist = _interpolate(pk, existant_pks, existant_widths)
            w_proj = _interpolate(pk, projet_pks, projet_widths)
            delta = None
            status = None
            if w_exist is not None and w_proj is not None:
                delta = w_proj - w_exist
                if delta > delta_seuil_m:
                    status = ComparisonStatus.AMELIORE
                elif delta < -delta_seuil_m:
                    status = ComparisonStatus.DEGRADE
                else:
                    status = ComparisonStatus.INCHANGE
            rows.append(
                ComparisonRow(
                    pk=pk,
                    side=side,
                    element_type=element_type,
                    width_existant=w_exist,
                    width_projet=w_proj,
                    delta=delta,
                    status=status,
                )
            )
    return rows
