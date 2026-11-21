import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["CORPUS_DATA_DIR"] = _tmp
os.environ["SPACY_SIZE"] = os.environ.get("SPACY_SIZE", "sm")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
