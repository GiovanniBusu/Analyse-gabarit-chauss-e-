import ezdxf
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.shape_builder as shape_builder
import pytest


def make_axis_profil_dxf(path: str) -> None:
    """Straight 100m axis with profile markers 1..6 every 20m (PK == station)."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    axis = msp.add_polyline2d([(0, 0), (50, 0), (100, 0)])
    axis.dxf.layer = "0"
    for i in range(6):
        x = i * 20.0
        msp.add_text(str(i + 1), dxfattribs={"height": 0.5, "color": 3, "style": "Standard"}).set_placement((x, 5))
    doc.saveas(path)


def make_state_dxf_heuristic(path: str, right_width: float = 3.0, left_width: float = 8.0) -> None:
    """Axis + 3 boundary lines -> 2 bands: right band width `right_width`,
    left band width `left_width`, constant along the corridor."""
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_polyline2d([(0, -right_width), (50, -right_width), (100, -right_width)])  # rightmost boundary
    msp.add_polyline2d([(0, 0), (50, 0), (100, 0)])  # axis / middle boundary
    msp.add_polyline2d([(0, left_width), (50, left_width), (100, left_width)])  # leftmost boundary
    doc.saveas(path)


def make_state_dxf_layers(path: str) -> None:
    doc = ezdxf.new("R2010")
    doc.layers.add("AXE-VOIE-G")
    doc.layers.add("COTE-VOIE-G")
    doc.layers.add("COTE-BAU-D")
    msp = doc.modelspace()
    ax = msp.add_polyline2d([(0, 0), (50, 0), (100, 0)])
    ax.dxf.layer = "AXE-VOIE-G"
    for i, x in enumerate([10.0, 30.0, 50.0, 70.0, 90.0]):
        t = msp.add_text("8.00", dxfattribs={"height": 0.3, "layer": "COTE-VOIE-G"})
        t.set_placement((x, 4))
        t2 = msp.add_text("3.25", dxfattribs={"height": 0.3, "layer": "COTE-BAU-D"})
        t2.set_placement((x, -4))
    doc.saveas(path)


def make_state_ifc(path: str, road_name: str, bands: list[tuple[str, float, float]]) -> None:
    """Bands: list of (pavement_type_name, y0, y1) in meters, each extruded as
    a flat ribbon running from x=0 to x=100 (mm internally, since the default
    project unit is millimetre — ifcopenshell.geom converts back to metres)."""
    ifc = ifcopenshell.api.run("project.create_file", version="IFC4X3")
    project = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcProject", name="Test")
    ifcopenshell.api.run("unit.assign_unit", ifc)
    context = ifcopenshell.api.run("context.add_context", ifc, context_type="Model")
    body = ifcopenshell.api.run(
        "context.add_context", ifc, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=context
    )
    site = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcSite", name="Site")
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=project, products=[site])
    road = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcRoad", name=road_name)
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=site, products=[road])
    road_part = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcRoadPart", name="Part")
    ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=road, products=[road_part])

    builder = shape_builder.ShapeBuilder(ifc)
    for type_name, y0, y1 in bands:
        pavement = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcPavement", name=type_name)
        ifcopenshell.api.run("aggregate.assign_object", ifc, relating_object=road_part, products=[pavement])
        pavement_type = ifcopenshell.api.run("root.create_entity", ifc, ifc_class="IfcPavementType", name=type_name)
        ifcopenshell.api.run("type.assign_type", ifc, related_objects=[pavement], relating_type=pavement_type)

        outer = [(0.0, y0 * 1000), (100000.0, y0 * 1000), (100000.0, y1 * 1000), (0.0, y1 * 1000)]
        curve = builder.polyline(outer, closed=True)
        solid = builder.extrude(curve, magnitude=200.0, extrusion_vector=(0.0, 0.0, 1.0))
        representation = builder.get_representation(body, [solid])
        ifcopenshell.api.run("geometry.assign_representation", ifc, product=pavement, representation=representation)
        ifcopenshell.api.run("geometry.edit_object_placement", ifc, product=pavement)

    ifc.write(path)


@pytest.fixture
def tmp_dxf_paths(tmp_path):
    axis_path = str(tmp_path / "axes_profils.dxf")
    heuristic_path = str(tmp_path / "state_heuristic.dxf")
    layers_path = str(tmp_path / "state_layers.dxf")
    make_axis_profil_dxf(axis_path)
    make_state_dxf_heuristic(heuristic_path)
    make_state_dxf_layers(layers_path)
    return {"axis": axis_path, "heuristic": heuristic_path, "layers": layers_path}


@pytest.fixture
def three_file_project(tmp_path):
    axis_path = str(tmp_path / "axes_profils.dxf")
    existant_path = str(tmp_path / "existant.dxf")
    projet_path = str(tmp_path / "projet.dxf")
    make_axis_profil_dxf(axis_path)
    make_state_dxf_heuristic(existant_path, right_width=3.0, left_width=7.2)
    make_state_dxf_heuristic(projet_path, right_width=3.25, left_width=8.0)
    return {"axes_profils": axis_path, "existant": existant_path, "projet": projet_path}


@pytest.fixture
def tmp_ifc_path(tmp_path):
    path = str(tmp_path / "existant.ifc")
    make_state_ifc(
        path,
        "Route existant",
        bands=[("Voie Gauche", 0.0, 8.0), ("BAU Droite", -3.25, 0.0)],
    )
    return path
