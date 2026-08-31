"""Compliance ratios: % of linear below the reduced threshold, between reduced
and standard, and at/above standard — per side, element type and state.
Missing samples are simply absent from the list, so they fall out of both
numerator and denominator (mirrors COUNTIFS ignoring blanks in the Excel export).
"""

from __future__ import annotations

from collections import defaultdict

from app.models.domain import ElementType, RatioResult, Side, StateKind, Threshold, WidthSample


def compute_ratios(samples: list[WidthSample], thresholds: list[Threshold]) -> list[RatioResult]:
    threshold_by_type = {t.element_type: t for t in thresholds}
    groups: dict[tuple[Side, ElementType, StateKind], list[float]] = defaultdict(list)
    for s in samples:
        if s.width_m is None:
            continue
        groups[(s.side, s.element_type, s.state)].append(s.width_m)

    results: list[RatioResult] = []
    for (side, element_type, state), widths in groups.items():
        threshold = threshold_by_type.get(element_type)
        n = len(widths)
        if threshold is None or n == 0:
            continue
        n_sous = sum(1 for w in widths if w < threshold.reduit_m)
        n_entre = sum(1 for w in widths if threshold.reduit_m <= w < threshold.standard_m)
        n_sur = sum(1 for w in widths if w >= threshold.standard_m)
        results.append(
            RatioResult(
                side=side,
                element_type=element_type,
                state=state,
                pct_sous_reduit=100.0 * n_sous / n,
                pct_entre=100.0 * n_entre / n,
                pct_sur_standard=100.0 * n_sur / n,
                n_samples=n,
            )
        )
    return results
