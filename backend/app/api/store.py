"""Format detection helper. There is no session store: the API is stateless
(see schemas.py docstring) — each /extract call gets its own temp directory
for the duration of that one request, and nothing is kept afterwards."""

from __future__ import annotations

from app.models.domain import SourceFormat


def detect_format(filename: str) -> SourceFormat:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "dxf":
        return SourceFormat.DXF
    if ext == "ifc":
        return SourceFormat.IFC
    raise ValueError(f"Unsupported file extension: .{ext} (expected .dxf or .ifc)")
