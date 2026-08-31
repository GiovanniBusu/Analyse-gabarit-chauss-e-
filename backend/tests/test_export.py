import ezdxf

from app.calculations.comparison import compare_states
from app.export.dxf_export import DxfExportOptions, build_dxf
from app.models.domain import DEFAULT_DELTA_SEUIL_M, DEFAULT_THRESHOLDS, ElementType, Side, SourceMethod, StateKind, WidthSample


def _make_samples():
    samples = []
    for pk in range(0, 51, 10):
        samples.append(
            WidthSample(pk=pk, side=Side.GAUCHE, element_type=ElementType.VOIE, state=StateKind.EXISTANT, width_m=7.2, source=SourceMethod.RECUPERATION_DXF)
        )
        samples.append(
            WidthSample(pk=pk, side=Side.GAUCHE, element_type=ElementType.VOIE, state=StateKind.PROJET, width_m=8.0, source=SourceMethod.RECUPERATION_DXF)
        )
    return samples


def test_build_dxf_layers_and_geometry(tmp_path):
    samples = _make_samples()
    comparison = compare_states(samples, DEFAULT_DELTA_SEUIL_M)
    options = DxfExportOptions(include_points=True, include_polylines=True, include_ratios=True, include_comparatif=True)
    doc = build_dxf(samples, DEFAULT_THRESHOLDS, comparison, options)

    path = str(tmp_path / "out.dxf")
    doc.saveas(path)
    reopened = ezdxf.readfile(path)
    layer_names = {layer.dxf.name for layer in reopened.layers}
    assert "EXISTANT_G_VOIE" in layer_names
    assert "PROJET_G_VOIE" in layer_names
    assert "RATIOS_EXISTANT_G_VOIE" in layer_names
    assert "COMPARATIF_G_VOIE" in layer_names

    msp = reopened.modelspace()
    points = [e for e in msp if e.dxftype() == "POINT"]
    polylines = [e for e in msp if e.dxftype() == "LWPOLYLINE"]
    assert len(points) > 0
    assert len(polylines) > 0


def test_build_dxf_respects_scope_options(tmp_path):
    samples = _make_samples()
    options = DxfExportOptions(include_points=True, include_polylines=False, include_projet=False, include_ratios=False)
    doc = build_dxf(samples, DEFAULT_THRESHOLDS, None, options)
    layer_names = {layer.dxf.name for layer in doc.layers}
    assert "EXISTANT_G_VOIE" in layer_names
    assert "PROJET_G_VOIE" not in layer_names
