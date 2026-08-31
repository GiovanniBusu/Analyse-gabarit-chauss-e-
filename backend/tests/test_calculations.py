from app.calculations.comparison import compare_states
from app.calculations.ratios import compute_ratios
from app.models.domain import (
    ComparisonStatus,
    DEFAULT_THRESHOLDS,
    ElementType,
    Side,
    SourceMethod,
    StateKind,
    WidthSample,
)


def _sample(pk, side, et, state, width):
    return WidthSample(pk=pk, side=side, element_type=et, state=state, width_m=width, source=SourceMethod.RECUPERATION_DXF)


def test_compute_ratios_buckets_correctly():
    samples = [
        _sample(0, Side.GAUCHE, ElementType.BAU, StateKind.EXISTANT, 2.0),  # < reduit (2.5)
        _sample(10, Side.GAUCHE, ElementType.BAU, StateKind.EXISTANT, 3.0),  # entre
        _sample(20, Side.GAUCHE, ElementType.BAU, StateKind.EXISTANT, 3.5),  # >= standard (3.25)
        _sample(30, Side.GAUCHE, ElementType.BAU, StateKind.EXISTANT, None),  # ignored
    ]
    results = compute_ratios(samples, DEFAULT_THRESHOLDS)
    assert len(results) == 1
    r = results[0]
    assert r.n_samples == 3
    assert abs(r.pct_sous_reduit - 100 / 3) < 1e-6
    assert abs(r.pct_entre - 100 / 3) < 1e-6
    assert abs(r.pct_sur_standard - 100 / 3) < 1e-6


def test_compare_states_status_and_interpolation():
    samples = [
        _sample(0, Side.GAUCHE, ElementType.VOIE, StateKind.EXISTANT, 7.0),
        _sample(20, Side.GAUCHE, ElementType.VOIE, StateKind.EXISTANT, 7.0),
        _sample(0, Side.GAUCHE, ElementType.VOIE, StateKind.PROJET, 7.0),
        _sample(10, Side.GAUCHE, ElementType.VOIE, StateKind.PROJET, 7.5),
        _sample(20, Side.GAUCHE, ElementType.VOIE, StateKind.PROJET, 8.0),
    ]
    rows = compare_states(samples, delta_seuil_m=0.05)
    by_pk = {r.pk: r for r in rows}
    assert by_pk[0].status == ComparisonStatus.INCHANGE
    # existant interpolated to 7.0 at pk=10, projet=7.5 -> delta 0.5 -> ameliore
    assert by_pk[10].status == ComparisonStatus.AMELIORE
    assert abs(by_pk[10].width_existant - 7.0) < 1e-9
    assert by_pk[20].status == ComparisonStatus.AMELIORE
