"""Install and remove spaCy models from the app (background thread, state polled by the UI).

Package names and URLs come only from `langcatalog`. An install goes to a temporary directory and is moved into
place only when it succeeded, so a failed or interrupted download never leaves something that looks installed.
"""
import importlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from . import langcatalog, nlp

_lock = threading.Lock()
_state: dict[str, dict] = {}
_threads: dict[str, threading.Thread] = {}


class Busy(Exception):
    """An install for this language is already running."""


def models_dir() -> Path | None:
    """Where models live (Docker: /models); None = the active Python environment."""
    d = os.environ.get("CORPORA_MODELS_DIR")
    return Path(d) if d else None


def state(code: str) -> dict:
    with _lock:
        return dict(_state.get(code, {"state": "idle", "message": ""}))


def _set(code: str, st: str, message: str = "") -> None:
    with _lock:
        _state[code] = {"state": st, "message": message}


def _run_installer(argv: list[str]) -> None:
    """The only place a subprocess is started (tests replace it)."""
    run = subprocess.run(argv, capture_output=True, text=True, timeout=1800)
    if run.returncode != 0:
        raise RuntimeError((run.stderr or run.stdout).strip()[-400:] or f"installer exited with {run.returncode}")


def _installer_argv(code: str, size: str, target: Path | None) -> list[str]:
    pkg = langcatalog.package(code, size)
    wheels = os.environ.get("SPACY_WHEELS")
    uv = shutil.which("uv")
    base = [uv, "pip", "install"] if uv else [sys.executable, "-m", "pip", "install"]
    argv = base + ["--no-deps"]
    if uv:
        argv += ["--no-cache"]
    if target is not None:
        argv += ["--target", str(target)]
    elif uv:
        argv += ["--python", sys.executable]
    if wheels and Path(wheels).is_dir():
        return argv + ["--no-index", "--find-links", wheels, pkg]
    return argv + [langcatalog.wheel_url(code, size)]


def install(code: str, size: str) -> None:
    langcatalog.package(code, size)        # ValueError for anything outside the catalog
    with _lock:
        if _state.get(code, {}).get("state") == "installing":
            raise Busy(code)
        _state[code] = {"state": "installing", "message": ""}
    t = threading.Thread(target=_do_install, args=(code, size), daemon=True, name=f"install-{code}")
    _threads[code] = t
    t.start()


def already_installed(code: str, size: str) -> bool:
    """The package for this size is installed at the catalog's version, so there is nothing to download."""
    return nlp.installed_version(langcatalog.package(code, size)) == langcatalog.MODEL_VERSION


def _do_install(code: str, size: str) -> None:
    dest = models_dir()
    tmp: Path | None = None
    try:
        if already_installed(code, size):
            nlp.evict(code)                 # the size may have changed: load the installed one next time
            _set(code, "idle")
            return
        if dest is not None:
            dest.mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(prefix=".install-", dir=dest))
        _run_installer(_installer_argv(code, size, tmp))
        if tmp is not None and dest is not None:
            for item in tmp.iterdir():
                target = dest / item.name
                if target.is_dir():
                    shutil.rmtree(target)
                shutil.move(str(item), str(target))
            if str(dest) not in sys.path:
                sys.path.insert(0, str(dest))
        importlib.invalidate_caches()
        nlp.evict(code)
        _set(code, "idle")
    except Exception as exc:  # noqa: BLE001 - shown to the user
        _set(code, "failed", str(exc) or exc.__class__.__name__)
    finally:
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)


def uninstall(code: str) -> None:
    entry = langcatalog.CATALOG.get(code)
    if entry is None:
        raise ValueError(f"Unknown language '{code}'")
    pkgs = [f"{entry.stem}_{s}" for s in entry.sizes]
    dest = models_dir()
    if dest is not None:
        for pkg in pkgs:
            shutil.rmtree(dest / pkg, ignore_errors=True)
            for d in dest.glob(f"{pkg}-*.dist-info"):
                shutil.rmtree(d, ignore_errors=True)
    else:
        have = [p for p in pkgs if nlp.installed_version(p)]
        if have:
            uv = shutil.which("uv")
            cmd = ([uv, "pip", "uninstall", "--python", sys.executable] if uv
                   else [sys.executable, "-m", "pip", "uninstall", "-y"])
            _run_installer(cmd + have)
    importlib.invalidate_caches()
    nlp.evict(code)
    _set(code, "idle")
