"""Logging: level and format from the environment, plus a timer for slow operations.

CORPORA_LOG_LEVEL   DEBUG, INFO (default), WARNING, ERROR
CORPORA_LOG_FORMAT  text (default) or json (one JSON object per line, for log collectors)
CORPORA_SLOW_MS     operations and requests slower than this are logged as warnings (default 1000; 0 = off)
"""
import json
import logging
import os
import time
from contextlib import contextmanager

log = logging.getLogger("corpora.timing")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {"time": self.formatTime(record), "level": record.levelname, "logger": record.name,
                "message": record.getMessage()}
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


def slow_ms() -> float:
    try:
        return float(os.environ.get("CORPORA_SLOW_MS", "1000"))
    except ValueError:
        return 1000.0


def configure() -> None:
    """Set the `corpora` loggers up from the environment (safe to call again)."""
    level = os.environ.get("CORPORA_LOG_LEVEL", "INFO").upper()
    root = logging.getLogger("corpora")
    root.setLevel(level if level in logging._nameToLevel else "INFO")
    if not any(getattr(h, "_corpora", False) for h in root.handlers):
        handler = logging.StreamHandler()
        handler._corpora = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    for h in root.handlers:
        if getattr(h, "_corpora", False):
            h.setFormatter(JsonFormatter() if os.environ.get("CORPORA_LOG_FORMAT", "").lower() == "json"
                           else logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))


@contextmanager
def timer(what: str):
    """Log `what` as a warning when the block takes longer than CORPORA_SLOW_MS."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        ms = (time.perf_counter() - t0) * 1000
        limit = slow_ms()
        if limit and ms >= limit:
            log.warning("Slow: %s took %.0f ms", what, ms)
