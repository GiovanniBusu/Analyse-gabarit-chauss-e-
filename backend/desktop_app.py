"""Entry point for the standalone Windows executable (built by PyInstaller,
see .github/workflows/build-windows-exe.yml). Starts the same FastAPI app
used in normal deployment on localhost, then opens it in the default browser.
No installation, no admin rights, no external server: everything the app
needs (backend + built frontend) is bundled into the one .exe.
"""

from __future__ import annotations

import socket
import threading
import time
import webbrowser

import uvicorn

HOST = "127.0.0.1"


def _find_free_port(preferred: int = 8765) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, preferred))
            return preferred
        except OSError:
            s.bind((HOST, 0))
            return s.getsockname()[1]


def _open_browser_when_ready(url: str) -> None:
    time.sleep(1.5)
    webbrowser.open(url)


def main() -> None:
    from app.main import app  # imported here so PyInstaller's frozen path patch (in app.main) runs first

    port = _find_free_port()
    url = f"http://{HOST}:{port}"

    print("=" * 60)
    print("  Analyse gabarit chaussée")
    print(f"  Ouverture automatique dans votre navigateur : {url}")
    print("  Laissez cette fenêtre ouverte pendant l'utilisation.")
    print("  Fermez cette fenêtre pour arrêter l'outil.")
    print("=" * 60)

    threading.Thread(target=_open_browser_when_ready, args=(url,), daemon=True).start()
    uvicorn.run(app, host=HOST, port=port, log_level="warning")


if __name__ == "__main__":
    main()
