"""Shared low-level DXF reading helpers: text inventory, text clustering by
visual attributes (the basis for telling cote values apart from PK/profile
labels without relying on numeric magnitude), and legacy-POLYLINE discovery
(the candidate axis / cross-section boundary lines)."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

import ezdxf
from ezdxf.document import Drawing

Point = tuple[float, float]

_NUMERIC_RE = re.compile(r"^-?\d+([.,]\d+)?$")
_CHAINAGE_RE = re.compile(r"^\d{1,4}[+.]\d{3}$")


@dataclass
class TextEntity:
    content: str
    x: float
    y: float
    height: float
    color: int
    style: str
    layer: str

    @property
    def numeric_value(self) -> float | None:
        text = self.content.strip().replace(",", ".")
        if _NUMERIC_RE.match(text):
            return float(text)
        if _CHAINAGE_RE.match(text):
            return _parse_chainage(text)
        return None

    @property
    def is_pure_int(self) -> bool:
        return self.content.strip().lstrip("-").isdigit()


def _parse_chainage(text: str) -> float:
    sep = "+" if "+" in text else "."
    main, sub = text.split(sep, 1)
    return float(main) * 1000 + float(sub)


def read_texts(doc: Drawing) -> list[TextEntity]:
    out: list[TextEntity] = []
    msp = doc.modelspace()
    for e in msp:
        if e.dxftype() == "TEXT":
            x, y, *_ = e.dxf.insert
            out.append(
                TextEntity(
                    content=e.dxf.text,
                    x=float(x),
                    y=float(y),
                    height=float(getattr(e.dxf, "height", 0.0)),
                    color=int(getattr(e.dxf, "color", 256)),
                    style=str(getattr(e.dxf, "style", "")),
                    layer=str(e.dxf.layer),
                )
            )
        elif e.dxftype() == "MTEXT":
            try:
                x, y, *_ = e.dxf.insert
            except Exception:
                continue
            out.append(
                TextEntity(
                    content=e.plain_text().strip(),
                    x=float(x),
                    y=float(y),
                    height=float(getattr(e.dxf, "char_height", 0.0)),
                    color=int(getattr(e.dxf, "color", 256)),
                    style=str(getattr(e.dxf, "style", "")),
                    layer=str(e.dxf.layer),
                )
            )
    return out


def cluster_texts(texts: list[TextEntity]) -> dict[tuple, list[TextEntity]]:
    """Group texts by (layer, color, rounded height, style) — visual attributes
    that in practice separate cote values, profile numbers and PK labels even
    when their numeric magnitudes overlap."""
    clusters: dict[tuple, list[TextEntity]] = defaultdict(list)
    for t in texts:
        key = (t.layer, t.color, round(t.height, 1), t.style)
        clusters[key].append(t)
    return dict(clusters)


def find_legacy_polylines(doc: Drawing) -> list[list[Point]]:
    """Return vertex lists for old-style POLYLINE entities only (never
    LWPOLYLINE): these are the entities the brief identifies as the true,
    unfragmented axis / cross-section boundary lines in cadwork DXF exports."""
    msp = doc.modelspace()
    lines: list[list[Point]] = []
    for e in msp:
        if e.dxftype() == "POLYLINE":
            pts = [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in e.vertices]
            if len(pts) >= 2:
                lines.append(pts)
    return lines


def named_axis_and_cote_layers(doc: Drawing) -> dict[str, list[str]] | None:
    """Detect an explicit layer-naming convention (e.g. AXE-BAU-G-EXT,
    COTE-BAU-S1) rather than guessing. Returns {'axis': [...], 'cote': [...]}
    of layer names if the convention is found, else None so callers fall back
    to the geometric heuristic."""
    axis_layers = [layer.dxf.name for layer in doc.layers if re.search(r"\bAXE\b", layer.dxf.name, re.I)]
    cote_layers = [layer.dxf.name for layer in doc.layers if re.search(r"\bCOTE\b", layer.dxf.name, re.I)]
    if axis_layers and cote_layers:
        return {"axis": axis_layers, "cote": cote_layers}
    return None


def load_document(path: str) -> Drawing:
    return ezdxf.readfile(path)
