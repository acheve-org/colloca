import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["COLLOCA_DATA_DIR"] = _tmp
os.environ["SPACY_SIZE"] = os.environ.get("SPACY_SIZE", "sm")

from fastapi.testclient import TestClient  # noqa: E402

from colloca import db, importer  # noqa: E402
from colloca.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        # the database is shared by the whole run: start every test without a base corpus
        with db.session() as conn:
            conn.execute("DELETE FROM corpora WHERE is_reference=1")
        importer._jobs.clear()   # ids of deleted corpora are reused by SQLite
        yield c
