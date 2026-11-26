import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["CORPORA_DATA_DIR"] = _tmp
os.environ["SPACY_SIZE"] = os.environ.get("SPACY_SIZE", "sm")

from fastapi.testclient import TestClient  # noqa: E402

from corpora import db, importer, languages  # noqa: E402
from corpora.main import app  # noqa: E402


def _ensure_test_languages() -> None:
    """A fresh install sets up no language; the tests work in Spanish and Italian, so set those up (again)."""
    with languages._session() as conn:
        conn.executemany("INSERT OR IGNORE INTO languages (code,name,model_size,tesseract,added) VALUES (?,?,NULL,?,?)",
                         [("es", "Spanish", "spa", "2000-01-01 00:00:00"),
                          ("it", "Italian", "ita", "2000-01-01 00:00:01")])
    languages._invalidate()


_ensure_test_languages()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        # the database is shared by the whole run: start every test without a base corpus
        with db.session() as conn:
            conn.execute("DELETE FROM corpora WHERE is_reference=1")
        importer._jobs.clear()   # ids of deleted corpora are reused by SQLite
        _ensure_test_languages()
        yield c
