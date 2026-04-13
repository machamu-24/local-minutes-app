#!/usr/bin/env python3
"""
PyInstaller で配布用 backend artifact を生成し、必要に応じて所定の場所へ配置する。
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


BACKEND_BINARY_NAME = "local-minutes-backend"
COLLECT_ALL_PACKAGES = [
    "fastapi",
    "starlette",
    "sqlalchemy",
    "faster_whisper",
    "ctranslate2",
    "tokenizers",
    "numpy",
    "av",
    "imageio_ffmpeg",
    "requests",
    "huggingface_hub",
    "tqdm",
    "onnxruntime",
    "pyyaml",
    "uvicorn",
    "anyio",
    "pydantic",
]
HIDDEN_IMPORTS = [
    "backend.routers.recordings",
    "backend.routers.transcripts",
    "backend.routers.summaries",
    "backend.routers.jobs",
    "backend.routers.runtime",
    "backend.services.audio",
    "backend.services.transcription",
    "backend.services.summarization",
    "backend.services.llm_provider",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "multipart.multipart",
]


def infer_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    if system == "windows":
        if machine in {"amd64", "x86_64"}:
            return "x86_64-pc-windows-msvc"
        if machine in {"arm64", "aarch64"}:
            return "aarch64-pc-windows-msvc"
    if system == "linux":
        if machine in {"x86_64", "amd64"}:
            return "x86_64-unknown-linux-gnu"
        if machine in {"arm64", "aarch64"}:
            return "aarch64-unknown-linux-gnu"

    raise RuntimeError(f"unsupported platform for target triple inference: {system}/{machine}")


def executable_suffix(target_triple: str) -> str:
    return ".exe" if "windows" in target_triple else ""


def resolve_python_executable(path_value: str) -> Path:
    candidate = Path(path_value)
    if candidate.exists():
        return candidate

    if os.name == "nt" and not candidate.suffix:
        candidate_with_exe = candidate.with_suffix(".exe")
        if candidate_with_exe.exists():
            return candidate_with_exe

    raise FileNotFoundError(f"python executable not found: {candidate}")


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    default_python = (
        repo_root / "backend" / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default=str(default_python), help="PyInstaller を実行する Python")
    parser.add_argument(
        "--target-triple",
        default=infer_target_triple(),
        help="出力 sidecar 名に使う target triple",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / "src-tauri" / "binaries"),
        help="生成した sidecar を配置するディレクトリ",
    )
    parser.add_argument(
        "--skip-stage",
        action="store_true",
        help="PyInstaller 出力のみ作成し、src-tauri/binaries へコピーしない",
    )
    parser.add_argument(
        "--bundle-mode",
        choices=("onefile", "onedir"),
        default="onefile",
        help="PyInstaller bundle mode",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    backend_dir = repo_root / "backend"
    launcher_path = backend_dir / "launcher.py"
    dist_dir = backend_dir / "dist" / "pyinstaller"
    work_dir = backend_dir / "build" / "pyinstaller"
    spec_dir = backend_dir / "build" / "pyinstaller-spec"
    config_dir = backend_dir / "build" / "pyinstaller-config"

    python_executable = resolve_python_executable(args.python)
    if not launcher_path.exists():
        raise FileNotFoundError(f"backend launcher not found: {launcher_path}")

    command = [
        str(python_executable),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--noconsole",
        "--name",
        BACKEND_BINARY_NAME,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--paths",
        str(repo_root),
        "--paths",
        str(backend_dir),
    ]

    command.append("--onefile" if args.bundle_mode == "onefile" else "--onedir")

    for package_name in COLLECT_ALL_PACKAGES:
        command.extend(["--collect-all", package_name])
    for hidden_import in HIDDEN_IMPORTS:
        command.extend(["--hidden-import", hidden_import])

    command.append(str(launcher_path))

    config_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("PYINSTALLER_CONFIG_DIR", str(config_dir))

    print("Running PyInstaller:")
    print(" ".join(command))
    subprocess.run(command, cwd=repo_root, env=env, check=True)

    suffix = executable_suffix(args.target_triple)
    if args.bundle_mode == "onefile":
        built_artifact = dist_dir / f"{BACKEND_BINARY_NAME}{suffix}"
    else:
        built_artifact = dist_dir / BACKEND_BINARY_NAME

    if not built_artifact.exists():
        raise FileNotFoundError(f"built backend artifact not found: {built_artifact}")

    print(f"Built backend artifact: {built_artifact}")

    if not args.skip_stage:
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        if args.bundle_mode == "onefile":
            staged_artifact = output_dir / f"{BACKEND_BINARY_NAME}-{args.target_triple}{suffix}"
            shutil.copy2(built_artifact, staged_artifact)
        else:
            staged_artifact = output_dir / f"{BACKEND_BINARY_NAME}-{args.target_triple}"
            if staged_artifact.exists():
                shutil.rmtree(staged_artifact)
            shutil.copytree(built_artifact, staged_artifact)
        print(f"Staged backend artifact: {staged_artifact}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
