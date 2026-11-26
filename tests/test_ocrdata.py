import os
import stat
import threading

import pytest

from corpora import langcatalog, languages, models, ocr, ocrdata
from corpora.ingest import IngestError

from .test_formats import scanned_pdf


@pytest.fixture()
def tdir(tmp_path, monkeypatch):
    d = tmp_path / "models"
    monkeypatch.setattr(models, "models_dir", lambda: d)
    monkeypatch.delenv("TESSDATA_FILES", raising=False)
    return d / "tessdata"


def wait(code):
    ocrdata._threads[code].join(5)


def test_install_downloads_catalog_url_to_temp_then_renames(tdir, monkeypatch):
    seen = []

    def fetch(url, dest):
        seen.append((url, dest.name))
        dest.write_bytes(b"data")
    monkeypatch.setattr(ocrdata, "_fetch", fetch)
    ocrdata.install("es")
    wait("es")
    assert seen[0][0] == langcatalog.tessdata_url("spa") and seen[0][1].endswith(".part")
    assert (tdir / "spa.traineddata").read_bytes() == b"data"
    assert [p.name for p in tdir.iterdir()] == ["spa.traineddata"]
    assert ocrdata.state("es")["state"] == "idle"


def test_failed_download_leaves_no_file(tdir, monkeypatch):
    def fetch(url, dest):
        dest.write_bytes(b"half")
        raise OSError("connection reset")
    monkeypatch.setattr(ocrdata, "_fetch", fetch)
    ocrdata.install("es")
    wait("es")
    st = ocrdata.state("es")
    assert st["state"] == "failed" and "connection reset" in st["message"]
    assert list(tdir.iterdir()) == []


def test_second_install_while_running_is_busy(tdir, monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(ocrdata, "_fetch", lambda url, dest: gate.wait(5) or dest.write_bytes(b"x"))
    ocrdata.install("es")
    try:
        with pytest.raises(models.Busy):
            ocrdata.install("es")
    finally:
        gate.set()
        wait("es")


def test_tessdata_files_offline_copies_without_fetch(tdir, tmp_path, monkeypatch):
    src = tmp_path / "files"
    src.mkdir()
    (src / "ita.traineddata").write_bytes(b"offline")
    monkeypatch.setenv("TESSDATA_FILES", str(src))
    monkeypatch.setattr(ocrdata, "_fetch", lambda *a: pytest.fail("must not download"))
    ocrdata.install("it")
    wait("it")
    assert (tdir / "ita.traineddata").read_bytes() == b"offline"


def test_install_without_ocr_code_is_rejected(tdir, client):
    languages.add("fr", "French", None, "")
    try:
        with pytest.raises(ValueError):
            ocrdata.install("fr")
    finally:
        languages.remove("fr")


def test_uninstall_removes_file(tdir):
    tdir.mkdir(parents=True)
    (tdir / "spa.traineddata").write_bytes(b"x")
    ocrdata.uninstall("es")
    assert not (tdir / "spa.traineddata").exists()


def test_tessdata_args_only_when_all_codes_in_app_dir(tdir):
    tdir.mkdir(parents=True)
    (tdir / "fra.traineddata").write_bytes(b"x")
    assert ocrdata.tessdata_args(["fra"]) == ["--tessdata-dir", str(tdir)]
    assert ocrdata.tessdata_args(["fra", "spa"]) == []
    assert ocrdata.tessdata_args([]) == []


def _logging_tesseract(tmp_path, monkeypatch, langs="eng"):
    log = tmp_path / "calls.log"
    exe = tmp_path / "tesseract"
    exe.write_text(f"#!/bin/sh\necho \"$@\" >> {log}\nif [ \"$1\" = \"--list-langs\" ]; then "
                   f"printf 'List of available languages:\\n{langs}\\n'; exit 0; fi\n"
                   "printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\t"
                   "width\\theight\\tconf\\ttext\\n"
                   "5\\t1\\t1\\t1\\t1\\t1\\t0\\t0\\t1\\t1\\t90\\thola\\n'\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    return log


def test_ocr_uses_registry_code(tmp_path, tdir, client, monkeypatch):
    log = _logging_tesseract(tmp_path, monkeypatch, langs="eng\nspa\nita")
    ocr.ocr_pdf(scanned_pdf(), "it")
    last = log.read_text().strip().splitlines()[-1]
    assert "-l ita" in last and "--tessdata-dir" not in last


def test_ocr_uses_app_folder_for_downloaded_data(tmp_path, tdir, client, monkeypatch):
    log = _logging_tesseract(tmp_path, monkeypatch)
    tdir.mkdir(parents=True)
    (tdir / "fra.traineddata").write_bytes(b"x")
    languages.add("fr", "French", None, "fra")
    try:
        ocr.ocr_pdf(scanned_pdf(), "fr")
    finally:
        languages.remove("fr")
    last = log.read_text().strip().splitlines()[-1]
    assert "-l fra" in last and f"--tessdata-dir {tdir}" in last


def test_missing_data_message_names_code_and_screen(tmp_path, tdir, client, monkeypatch):
    _logging_tesseract(tmp_path, monkeypatch, langs="eng")
    with pytest.raises(IngestError, match="no language data for spa.*Languages screen"):
        ocr.ocr_pdf(scanned_pdf(), "es")
