# PyInstaller spec for the standalone Windows executable. Built by
# .github/workflows/build-windows-exe.yml on windows-latest (a portable
# one-file .exe cannot be reliably cross-built from Linux).
#
# ifcopenshell ships its IFC schema definitions and native extension as
# package data, and uvicorn resolves several of its implementations lazily
# by import string — both are classic PyInstaller under-detection cases, so
# they're collected explicitly below rather than left to the default
# analysis.

from PyInstaller.utils.hooks import collect_all

datas = [("../frontend/dist", "frontend/dist")]
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

for pkg in ("ifcopenshell", "ezdxf"):
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

a = Analysis(
    ["desktop_app.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AnalyseGabaritChaussee",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
