import pytest

from corpora import db, languages, models, ocrdata

from .test_api import default_project


@pytest.fixture()
def calls(client, monkeypatch):
    rec = {"model": [], "ocr": [], "uninstall": []}
    monkeypatch.setattr(models, "install", lambda code, size: rec["model"].append((code, size)))
    monkeypatch.setattr(ocrdata, "install", lambda code: rec["ocr"].append(code))
    monkeypatch.setattr(models, "uninstall", lambda code: rec["uninstall"].append(code))
    yield rec
    with db.session() as conn:
        conn.execute("DELETE FROM corpora WHERE lang NOT IN ('es','it')")
    for lang in languages.all_languages():
        if lang.code not in ("es", "it"):
            languages.remove(lang.code)
    languages.update("es", model_size=None, name="Spanish", tesseract="spa")


def test_catalog_marks_added_languages(client):
    cat = {e["code"]: e for e in client.get("/api/language-catalog").json()}
    assert cat["es"]["added"] is True and cat["fr"]["added"] is False
    assert cat["fr"]["sizes"] == ["sm", "md", "lg"] and cat["fr"]["tesseract"] == "fra"


def test_add_language_starts_model_install(client, calls):
    r = client.post("/api/languages", json={"code": "fr", "size": "sm", "install_ocr": True})
    assert r.status_code == 201 and r.json() == {"code": "fr"}
    assert calls["model"] == [("fr", "sm")] and calls["ocr"] == ["fr"]
    assert client.get("/api/languages").json()["fr"] == "French"
    assert languages.get("fr").tesseract == "fra"


def test_add_without_size_installs_lg_when_spacy_size_is_unset(client, calls, monkeypatch):
    monkeypatch.delenv("SPACY_SIZE", raising=False)
    assert client.post("/api/languages", json={"code": "fr"}).status_code == 201
    assert calls["model"] == [("fr", "lg")]


def test_add_without_install(client, calls):
    r = client.post("/api/languages", json={"code": "de", "install_model": False})
    assert r.status_code == 201 and calls["model"] == [] and calls["ocr"] == []


def test_add_duplicate_is_409(client, calls):
    assert client.post("/api/languages", json={"code": "es"}).status_code == 409


def test_add_unknown_code_or_size_is_400(client, calls):
    assert client.post("/api/languages", json={"code": "zz"}).status_code == 400
    assert client.post("/api/languages", json={"code": "fr", "size": "trf"}).status_code == 400
    assert calls["model"] == []


def test_patch_size_reinstalls(client, calls):
    r = client.patch("/api/languages/es", json={"name": "Español", "model_size": "lg", "tesseract": "spa"})
    assert r.status_code == 200
    assert languages.get("es").model_size == "lg" and languages.get("es").name == "Español"
    assert calls["model"] == [("es", "lg")]
    assert client.patch("/api/languages/es", json={"name": "Spanish"}).status_code == 200
    assert calls["model"] == [("es", "lg")]                       # no size in the body: nothing reinstalled
    assert client.patch("/api/languages/zz", json={"name": "x"}).status_code == 404


def test_delete_with_corpus_is_409_and_with_none_is_204(client, calls):
    client.post("/api/languages", json={"code": "fr", "install_model": False})
    body = {"name": "fr corpus", "lang": "fr", "project_id": default_project(client)}
    cid = client.post("/api/corpora", json=body).json()["id"]
    r = client.delete("/api/languages/fr")
    assert r.status_code == 409 and "1" in r.json()["detail"]
    client.delete(f"/api/corpora/{cid}")                          # to the Trash
    assert client.delete("/api/languages/fr").status_code == 409  # trashed corpora still count
    client.delete("/api/trash?confirm=true")
    assert client.delete("/api/languages/fr?uninstall_model=true").status_code == 204
    assert calls["uninstall"] == ["fr"] and "fr" not in client.get("/api/languages").json()
    assert client.delete("/api/languages/fr").status_code == 404


def test_language_settings_lists_state_and_corpus_count(client, calls):
    rows = {r["code"]: r for r in client.get("/api/language-settings").json()}
    es = rows["es"]
    assert es["name"] == "Spanish" and es["tesseract"] == "spa" and "corpus_count" in es
    assert set(es["model"]) >= {"name", "version", "size", "small", "state", "message"}
    assert set(es["ocr"]) >= {"engine", "tesseract", "available", "state", "message"}


def test_model_and_ocr_endpoints(client, calls, monkeypatch):
    assert client.post("/api/languages/es/model", json={"size": "md"}).status_code == 202
    assert calls["model"] == [("es", "md")] and languages.get("es").model_size == "md"
    assert client.delete("/api/languages/es/model").status_code == 204 and calls["uninstall"] == ["es"]
    assert client.post("/api/languages/es/ocr").status_code == 202 and calls["ocr"] == ["es"]

    def busy(*a):
        raise models.Busy("es")
    monkeypatch.setattr(models, "install", busy)
    monkeypatch.setattr(ocrdata, "install", busy)
    assert client.post("/api/languages/es/model", json={}).status_code == 409
    assert client.post("/api/languages/es/ocr").status_code == 409
    assert client.post("/api/languages/zz/model", json={}).status_code == 404


def test_corpus_in_unregistered_language_is_400(client):
    body = {"name": "x", "lang": "zz", "project_id": default_project(client)}
    assert client.post("/api/corpora", json=body).status_code == 400
    assert client.post("/api/references", json={"lang": "zz"}).status_code == 400
