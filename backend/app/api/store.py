"""In-memory project store. No database: this is an MVP focused on the
extraction/calculation pipeline; swapping in persistent storage later only
touches this module (ProjectState is already the full unit of state)."""

from __future__ import annotations

import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.extraction.axis_reference import AxisReference
from app.models.domain import (
    DEFAULT_DELTA_SEUIL_M,
    DEFAULT_THRESHOLDS,
    Band,
    ElementType,
    Side,
    SourceFormat,
    Threshold,
    WidthSample,
)

ROLES = ("axes_profils", "existant", "projet")


def detect_format(filename: str) -> SourceFormat:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "dxf":
        return SourceFormat.DXF
    if ext == "ifc":
        return SourceFormat.IFC
    raise ValueError(f"Unsupported file extension: .{ext} (expected .dxf or .ifc)")


@dataclass
class UploadedFile:
    path: str
    filename: str
    fmt: SourceFormat


@dataclass
class ProjectState:
    project_id: str
    work_dir: Path
    files: dict[str, UploadedFile] = field(default_factory=dict)
    gabarit: str = "route"
    dxf_step_m: float = 5.0
    thresholds: list[Threshold] = field(default_factory=lambda: list(DEFAULT_THRESHOLDS))
    delta_seuil_m: float = DEFAULT_DELTA_SEUIL_M
    overrides: dict[str, tuple[Side, ElementType]] = field(default_factory=dict)

    axis: AxisReference | None = None
    bands: dict[str, Band] = field(default_factory=dict)
    samples: list[WidthSample] = field(default_factory=list)
    existant_mode: str | None = None
    projet_mode: str | None = None

    def is_ready_to_extract(self) -> bool:
        return all(role in self.files for role in ROLES)


class ProjectStore:
    def __init__(self) -> None:
        self._projects: dict[str, ProjectState] = {}

    def create(self) -> ProjectState:
        project_id = uuid.uuid4().hex
        work_dir = Path(tempfile.mkdtemp(prefix=f"gabarit_{project_id}_"))
        state = ProjectState(project_id=project_id, work_dir=work_dir)
        self._projects[project_id] = state
        return state

    def get(self, project_id: str) -> ProjectState:
        if project_id not in self._projects:
            raise KeyError(project_id)
        return self._projects[project_id]


store = ProjectStore()
