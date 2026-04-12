#!/usr/bin/env python3
"""
Create a portable Windows distribution that serves the built frontend from the
packaged backend executable.
"""

from __future__ import annotations

import argparse
import shutil
import textwrap
from pathlib import Path


START_BAT_CONTENT = r"""@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "LOCAL_MINUTES_APP_DATA_DIR=%LOCALAPPDATA%\LocalMinutes"
set "LOCAL_MINUTES_FRONTEND_DIST=%SCRIPT_DIR%dist"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue';" ^
  "try {" ^
  "  $health = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/api/health' -TimeoutSec 2;" ^
  "  if ($health.StatusCode -eq 200) {" ^
  "    Start-Process 'http://127.0.0.1:8000';" ^
  "    exit 0" ^
  "  }" ^
  "} catch {};" ^
  "exit 1"
if "%ERRORLEVEL%"=="0" exit /b 0

start "" "%SCRIPT_DIR%local-minutes-backend.exe"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue';" ^
  "$ok = $false;" ^
  "for ($i = 0; $i -lt 90; $i++) {" ^
  "  try {" ^
  "    $health = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/api/health' -TimeoutSec 2;" ^
  "    if ($health.StatusCode -eq 200) {" ^
  "      $ok = $true;" ^
  "      break" ^
  "    }" ^
  "  } catch {};" ^
  "  Start-Sleep -Seconds 1" ^
  "};" ^
  "Start-Process 'http://127.0.0.1:8000';" ^
  "if (-not $ok) { exit 1 }"
"""

PORTABLE_README_CONTENT = """\
Local Minutes Portable (Windows)
================================

Files in this folder
--------------------
- local-minutes-backend.exe : bundled backend executable
- dist/                     : built frontend assets
- start-local-minutes.bat   : starts the backend and opens the browser UI

Recommended usage
-----------------
1. Install Ollama on the target Windows PC.
2. Pull the model you want to use, for example:
     ollama pull qwen3:4b
3. Double-click start-local-minutes.bat
4. The browser UI opens at http://127.0.0.1:8000

Notes
-----
- This package intentionally avoids Tauri/NSIS. It uses the browser as the UI.
- Data is stored under %LOCALAPPDATA%\\LocalMinutes by default.
- If the backend does not start on a clean Windows machine, install the latest
  Microsoft Visual C++ Redistributable and run the launcher again.
- If vc_redist.x64.exe is present in this folder, run it once before launching.
"""


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backend-path",
        required=True,
        help="Path to the built Windows backend executable",
    )
    parser.add_argument(
        "--frontend-dist",
        default=str(repo_root / "frontend" / "dist"),
        help="Path to frontend/dist",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / "dist" / "portable-windows"),
        help="Destination directory for the portable package",
    )
    parser.add_argument(
        "--vc-redist-path",
        help="Optional path to vc_redist.x64.exe to copy into the package",
    )
    parser.add_argument(
        "--archive",
        action="store_true",
        help="Also create a .zip archive next to the output directory",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace the output directory if it already exists",
    )
    return parser.parse_args()


def ensure_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    if not path.is_file():
        raise ValueError(f"{label} must be a file: {path}")


def ensure_dir(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    if not path.is_dir():
        raise ValueError(f"{label} must be a directory: {path}")


def write_text_file(path: Path, content: str) -> None:
    path.write_text(textwrap.dedent(content), encoding="utf-8", newline="\r\n")


def main() -> int:
    args = parse_args()
    backend_path = Path(args.backend_path).expanduser().resolve()
    frontend_dist = Path(args.frontend_dist).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    ensure_file(backend_path, "backend executable")
    ensure_dir(frontend_dist, "frontend dist")

    if output_dir.exists():
        if not args.force:
            raise FileExistsError(
                f"output directory already exists: {output_dir} (pass --force to replace it)"
            )
        shutil.rmtree(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backend_path, output_dir / "local-minutes-backend.exe")
    shutil.copytree(frontend_dist, output_dir / "dist")

    if args.vc_redist_path:
        vc_redist_path = Path(args.vc_redist_path).expanduser().resolve()
        ensure_file(vc_redist_path, "vc_redist")
        shutil.copy2(vc_redist_path, output_dir / vc_redist_path.name)

    write_text_file(output_dir / "start-local-minutes.bat", START_BAT_CONTENT)
    write_text_file(output_dir / "README-PORTABLE.txt", PORTABLE_README_CONTENT)

    if args.archive:
        archive_path = shutil.make_archive(
            str(output_dir),
            "zip",
            root_dir=output_dir.parent,
            base_dir=output_dir.name,
        )
        print(f"Created archive: {archive_path}")

    print(f"Portable package created: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
