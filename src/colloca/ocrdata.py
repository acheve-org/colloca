"""Tesseract language data (`<code>.traineddata`), managed per language from the app.

The Tesseract program is a system package (installed at image build); its data files are plain files that it can read
from any folder (`--tessdata-dir`), so the app downloads them from the official `tessdata_fast` set into its own
folder without root. File names come only from the catalog.
"""
import os
import shutil
import subprocess
import threading
import urllib.request
from pathlib import Path

from . import langcatalog, languages, models

_lock = threading.Lock()
_state: dict[str, dict] = {}
_threads: dict[str, threading.Thread] = {}


def data_dir() -> Path:
    d = models.models_dir()
    return (d if d is not None else Path(os.environ.get("COLLOCA_DATA_DIR", "./data"))) / "tessdata"


def engine_present() -> bool:
    return shutil.which("tesseract") is not None


def state(code: str) -> dict:
    with _lock:
        return dict(_state.get(code, {"state": "idle", "message": ""}))


def _set(code: str, st: str, message: str = "") -> None:
    with _lock:
        _state[code] = {"state": st, "message": message}


def _traineddata(code: str) -> str:
    """The Tesseract code of language `code`, checked against the catalog (ValueError otherwise)."""
    lang = languages.get(code)
    if lang is None or not lang.tesseract:
        raise ValueError(f"No OCR language is set for '{code}'")
    langcatalog.tessdata_url(lang.tesseract)
    return lang.tesseract


def list_langs(extra: list[str] | None = None) -> set[str]:
    exe = shutil.which("tesseract")
    if not exe:
        return set()
    try:
        out = subprocess.run([exe, "--list-langs", *(extra or [])], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return set()
    return set(out.stdout.split()) | set(out.stderr.split())


def in_app_dir(tesseract: str) -> bool:
    return (data_dir() / f"{tesseract}.traineddata").is_file()


def available(tesseract: str) -> bool:
    return bool(tesseract) and (in_app_dir(tesseract) or tesseract in list_langs())


def tessdata_args(codes: list[str]) -> list[str]:
    """`--tessdata-dir` for the app's folder, only when it holds the data of every code."""
    if codes and all(in_app_dir(c) for c in codes):
        return ["--tessdata-dir", str(data_dir())]
    return []


def _fetch(url: str, dest: Path) -> None:
    urllib.request.urlretrieve(url, dest)  # noqa: S310 - fixed https GitHub URL built from the catalog


def install(code: str) -> None:
    tess = _traineddata(code)
    with _lock:
        if _state.get(code, {}).get("state") == "installing":
            raise models.Busy(code)
        _state[code] = {"state": "installing", "message": ""}
    t = threading.Thread(target=_do_install, args=(code, tess), daemon=True, name=f"ocr-{code}")
    _threads[code] = t
    t.start()


def _do_install(code: str, tess: str) -> None:
    folder = data_dir()
    part = folder / f"{tess}.traineddata.part"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        offline = os.environ.get("TESSDATA_FILES")
        if offline:
            src = Path(offline) / f"{tess}.traineddata"
            if not src.is_file():
                raise FileNotFoundError(f"{src.name} not found in TESSDATA_FILES")
            shutil.copyfile(src, part)
        else:
            _fetch(langcatalog.tessdata_url(tess), part)
        os.replace(part, folder / f"{tess}.traineddata")
        _set(code, "idle")
    except Exception as exc:  # noqa: BLE001 - shown to the user
        _set(code, "failed", str(exc) or exc.__class__.__name__)
    finally:
        part.unlink(missing_ok=True)


def uninstall(code: str) -> None:
    tess = _traineddata(code)
    (data_dir() / f"{tess}.traineddata").unlink(missing_ok=True)
    _set(code, "idle")
