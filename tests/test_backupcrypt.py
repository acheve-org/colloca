"""Encrypted backups (T23): the cipher, and export / import through the API."""
import io
import os
import zipfile

import pytest

from corpora import backupcrypt as bc
from corpora import db

from .test_api import ES_TEXT, add, make_corpus
from .test_projects import project

PASS = "a long enough passphrase"


@pytest.fixture(autouse=True)
def _small_chunks(monkeypatch):
    monkeypatch.setattr(bc, "CHUNK", 64)                       # several chunks even for a tiny file


def enc(tmp_path, data: bytes, passphrase=PASS) -> bytes:
    src, dst = tmp_path / "plain", tmp_path / "enc"
    src.write_bytes(data)
    bc.encrypt_file(str(src), str(dst), passphrase)
    return dst.read_bytes()


# --------------------------------------------------------------------------- the cipher
@pytest.mark.parametrize("size", [0, 1, 63, 64, 65, 64 * 5, 64 * 5 + 7])
def test_round_trip_for_every_chunk_boundary(tmp_path, size):
    data = os.urandom(size)
    blob = enc(tmp_path, data)
    assert bc.is_encrypted(blob)
    assert size < 16 or data not in blob                      # (a 1-byte input could match a header byte by chance)
    assert bc.decrypt_bytes(blob, PASS) == data


def test_the_plain_text_is_not_in_the_file(tmp_path):
    secret = b"Cliente confidencial: contrato Acme S.L. " * 10
    assert b"confidencial" not in enc(tmp_path, secret)


def test_same_input_gives_different_files(tmp_path):
    assert enc(tmp_path, b"x" * 100) != enc(tmp_path, b"x" * 100)       # fresh salt and nonce prefix


def test_wrong_passphrase_is_refused(tmp_path):
    blob = enc(tmp_path, b"secret " * 40)
    with pytest.raises(bc.CryptError, match="Wrong passphrase"):
        bc.decrypt_bytes(blob, "another passphrase")


def test_any_damage_is_detected(tmp_path):
    data = os.urandom(64 * 4)
    blob = enc(tmp_path, data)
    flipped = bytearray(blob)
    flipped[len(blob) // 2] ^= 1
    with pytest.raises(bc.CryptError):
        bc.decrypt_bytes(bytes(flipped), PASS)
    with pytest.raises(bc.CryptError):                                   # cut off: the end marker is missing
        bc.decrypt_bytes(blob[: len(blob) - 70], PASS)
    with pytest.raises(bc.CryptError):
        bc.decrypt_bytes(blob[:-1], PASS)
    with pytest.raises(bc.CryptError):
        bc.decrypt_bytes(blob + b"\x00\x00", PASS)                       # trailing junk
    with pytest.raises(bc.CryptError):
        bc.decrypt_bytes(blob[: len(bc.MAGIC) + 5], PASS)                # header only


def test_chunks_cannot_be_reordered_or_dropped(tmp_path):
    blob = enc(tmp_path, os.urandom(64 * 3))
    head = len(bc.MAGIC) + bc._HEADER.size + 4
    chunks, pos = [], head
    while pos < len(blob):
        n = int.from_bytes(blob[pos:pos + 4], "big")
        chunks.append(blob[pos:pos + 4 + n])
        pos += 4 + n
    assert len(chunks) == 3
    for order in ([1, 0, 2], [0, 2], [0, 1], [1, 2]):
        with pytest.raises(bc.CryptError):
            bc.decrypt_bytes(blob[:head] + b"".join(chunks[i] for i in order), PASS)


def test_short_passphrase_and_non_encrypted_input(tmp_path):
    src = tmp_path / "p"
    src.write_bytes(b"x")
    with pytest.raises(bc.CryptError, match="at least"):
        bc.encrypt_file(str(src), str(tmp_path / "o"), "short")
    with pytest.raises(bc.CryptError, match="Not an encrypted"):
        bc.decrypt_bytes(b"PK\x03\x04", PASS)
    assert not bc.is_encrypted(b"PK") and not bc.is_encrypted(b"")


def test_limit_caps_the_decrypted_size(tmp_path):
    blob = enc(tmp_path, b"y" * 500)
    with pytest.raises(bc.CryptError, match="larger"):
        bc.decrypt_bytes(blob, PASS, limit=100)


# --------------------------------------------------------------------------- through the API
@pytest.fixture()
def data(client):
    with db.session() as conn:
        conn.execute("DELETE FROM projects WHERE name='Acme encriptado'")
    pid = project(client, "Acme encriptado")
    cid = make_corpus(client, "es", "secretos")
    client.patch(f"/api/corpora/{cid}", json={"project_id": pid})
    add(client, cid, ES_TEXT, "informe confidencial")
    return pid, cid


def export(client, **body):
    return client.post("/api/backup/encrypted", json={"passphrase": PASS, **body})


def test_encrypted_backup_has_no_readable_content_and_is_a_download(client, data):
    r = export(client)
    assert r.status_code == 200 and ".zip.enc" in r.headers["content-disposition"]
    assert bc.is_encrypted(r.content)
    assert b"informe confidencial" not in r.content and b"PK\x03\x04" not in r.content[:20]
    assert zipfile.is_zipfile(io.BytesIO(bc.decrypt_bytes(r.content, PASS)))


def test_import_needs_the_passphrase_and_restores_the_content(client, data):
    pid, cid = data
    blob = export(client, project_id=pid).content
    with db.session() as conn:
        conn.execute("DELETE FROM corpora WHERE id=?", (cid,))
        conn.execute("DELETE FROM projects WHERE id=?", (pid,))
    files = {"file": ("b.zip.enc", blob)}
    r = client.post("/api/import", data={"dry_run": "true"}, files=files)
    assert r.status_code == 400 and "encrypted" in r.json()["detail"] and "passphrase" in r.json()["detail"]
    r = client.post("/api/import", data={"dry_run": "true", "passphrase": "not the right one"}, files=files)
    assert r.status_code == 400 and "Wrong passphrase" in r.json()["detail"]
    dry = client.post("/api/import", data={"dry_run": "true", "passphrase": PASS}, files=files).json()
    assert dry["dry_run"] is True and dry["created"]["documents"] == 1
    done = client.post("/api/import", data={"dry_run": "false", "passphrase": PASS, "annotate": "false"},
                       files=files).json()
    assert done["created"]["documents"] == 1 and done["created"]["corpora"] == 1


def test_the_whole_database_round_trips_with_its_sqlite_copy(client, data):
    blob = export(client, include_sqlite=True).content
    plain = bc.decrypt_bytes(blob, PASS)
    with zipfile.ZipFile(io.BytesIO(plain)) as z:
        assert {"manifest.json", "data.json", "corpus.db"} <= set(z.namelist())


def test_a_short_passphrase_or_unknown_project_is_refused(client, data):
    assert client.post("/api/backup/encrypted", json={"passphrase": "short"}).status_code == 422
    assert export(client, project_id=999999).status_code == 404


def test_encrypted_export_leaves_no_temporary_files(client, data, tmp_path, monkeypatch):
    import tempfile
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    assert export(client).status_code == 200
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith("corpora-export-")] == []


def test_plain_backups_still_work(client, data):
    r = client.get("/api/backup")
    assert r.status_code == 200 and zipfile.is_zipfile(io.BytesIO(r.content))
