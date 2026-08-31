import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response

from app.api.routes import router


class NoCacheStaticFiles(StaticFiles):
    """Forces revalidation (ETag/If-None-Match) on every static file instead
    of letting the browser reuse a cached copy indefinitely. Without this, a
    browser that visited before a deploy keeps running the OLD index.html —
    which references the old build's JS bundle and can call API routes that
    no longer exist on the new backend (exactly what happened here: a stale
    frontend calling the removed /api/projects/{id}/extract route)."""

    def file_response(self, *args: object, **kwargs: object) -> Response:
        response = super().file_response(*args, **kwargs)  # type: ignore[arg-type]
        response.headers["Cache-Control"] = "no-cache"
        return response

app = FastAPI(title="Analyse gabarit chaussée", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Single-service deployment: the built frontend (frontend/dist) is served
# from the same origin as the API, so no cross-origin config is needed in
# production (Docker/Render) nor in the standalone .exe. Mounted last and
# only if present, so `uvicorn --reload` still works locally without
# requiring a frontend build.
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller onefile bundle: bundled data lives under
    # sys._MEIPASS (see --add-data in the build workflow), not next to this file.
    _frontend_dist = Path(getattr(sys, "_MEIPASS")) / "frontend" / "dist"
else:
    _frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if _frontend_dist.is_dir():
    app.mount("/", NoCacheStaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
