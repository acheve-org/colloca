import threading

import pytest

from corpora import langcatalog, languages, models, nlp


@pytest.fixture()
def mdir(tmp_path, monkeypatch):
    d = tmp_path / "models"
    monkeypatch.setattr(models, "models_dir", lambda: d)
    monkeypatch.delenv("SPACY_WHEELS", raising=False)
    monkeypatch.setattr(nlp, "installed_version", lambda pkg: None)    # the dev environment may hold real models
    nlp._models.clear()
    yield d
    nlp._models.clear()


def fake_ok(calls):
    def run(argv):
        calls.append(argv)
        target = argv[argv.index("--target") + 1]
        import pathlib
        t = pathlib.Path(target)
        pkg = next(a for a in argv if a.startswith("http")).rsplit("/", 1)[1].split("-")[0] \
            if any(a.startswith("http") for a in argv) else argv[-1]
        (t / pkg).mkdir(parents=True)
        (t / pkg / "meta.json").write_text("{}")
        (t / f"{pkg}-3.8.0.dist-info").mkdir()
    return run


def wait(code):
    models._threads[code].join(5)


def test_install_runs_installer_then_reports_idle(mdir, monkeypatch):
    calls = []
    monkeypatch.setattr(models, "_run_installer", fake_ok(calls))
    models.install("es", "sm")
    wait("es")
    assert models.state("es") == {"state": "idle", "message": ""}
    assert (mdir / "es_core_news_sm" / "meta.json").exists()
    assert (mdir / "es_core_news_sm-3.8.0.dist-info").is_dir()
    assert [p.name for p in mdir.iterdir() if p.name.startswith(".")] == []     # temp dir removed


def test_install_argv_uses_catalog_url_only(mdir, monkeypatch):
    calls = []
    monkeypatch.setattr(models, "_run_installer", fake_ok(calls))
    models.install("es", "sm")
    wait("es")
    assert langcatalog.wheel_url("es", "sm") in calls[0]
    assert "--no-deps" in calls[0]


def test_failed_install_reports_message_and_leaves_nothing(mdir, monkeypatch):
    def boom(argv):
        import pathlib
        (pathlib.Path(argv[argv.index("--target") + 1]) / "es_core_news_sm").mkdir()   # half done
        raise RuntimeError("no network")
    monkeypatch.setattr(models, "_run_installer", boom)
    models.install("es", "sm")
    wait("es")
    st = models.state("es")
    assert st["state"] == "failed" and "no network" in st["message"]
    assert not (mdir / "es_core_news_sm").exists()
    assert [p.name for p in mdir.iterdir()] == []


def test_second_install_while_running_is_busy(mdir, monkeypatch):
    gate = threading.Event()
    monkeypatch.setattr(models, "_run_installer", lambda argv: gate.wait(5))
    models.install("es", "sm")
    try:
        assert models.state("es")["state"] == "installing"
        with pytest.raises(models.Busy):
            models.install("es", "md")
    finally:
        gate.set()
        wait("es")


def test_unknown_code_or_size_is_rejected_without_running_installer(mdir, monkeypatch):
    called = []
    monkeypatch.setattr(models, "_run_installer", lambda argv: called.append(argv))
    for code, size in (("zz", "sm"), ("es", "trf"), ("../x", "sm")):
        with pytest.raises(ValueError):
            models.install(code, size)
    assert called == []


def test_wheels_dir_uses_no_index(mdir, tmp_path, monkeypatch):
    wheels = tmp_path / "wheels"
    wheels.mkdir()
    monkeypatch.setenv("SPACY_WHEELS", str(wheels))
    calls = []
    monkeypatch.setattr(models, "_run_installer", fake_ok(calls))
    models.install("it", "md")
    wait("it")
    argv = calls[0]
    assert "--no-index" in argv and argv[argv.index("--find-links") + 1] == str(wheels)
    assert not any(a.startswith("http") for a in argv) and "it_core_news_md" in argv


def test_uninstall_removes_package_and_evicts_cache(mdir):
    for pkg in ("es_core_news_sm", "es_core_news_lg", "it_core_news_sm"):
        (mdir / pkg).mkdir(parents=True)
        (mdir / f"{pkg}-3.8.0.dist-info").mkdir()
    nlp._models["es"] = object()
    models.uninstall("es")
    assert sorted(p.name for p in mdir.iterdir()) == ["it_core_news_sm", "it_core_news_sm-3.8.0.dist-info"]
    assert "es" not in nlp._models


def test_load_model_prefers_registry_size(client, monkeypatch):
    tried = []

    def fake_load(name, **kw):
        tried.append(name)
        raise OSError(name)
    monkeypatch.setattr(nlp.spacy, "load", fake_load)
    nlp._models.clear()
    languages.update("es", model_size="lg")
    try:
        with pytest.raises(RuntimeError, match="Languages screen"):
            nlp.load_model("es")
    finally:
        languages.update("es", model_size=None)
    assert tried[0] == "es_core_news_lg"


def test_status_sees_a_model_installed_while_the_app_runs(client, tmp_path, monkeypatch):
    # spaCy's own installed-model list is cached, so a fresh install would show as "not installed" until a restart
    import importlib
    info = tmp_path / "fr_core_news_sm-3.8.0.dist-info"
    info.mkdir()
    (info / "METADATA").write_text("Metadata-Version: 2.1\nName: fr_core_news_sm\nVersion: 3.8.0\n")
    languages.add("fr", "French", "sm", "fra")
    try:
        assert nlp.status()["fr"]["name"] is None
        monkeypatch.syspath_prepend(str(tmp_path))
        importlib.invalidate_caches()
        assert nlp.status()["fr"] == {"name": "fr_core_news_sm", "version": "3.8.0", "size": "sm", "small": True}
    finally:
        languages.remove("fr")


def test_install_skips_download_when_same_size_and_version_is_installed(mdir, monkeypatch):
    monkeypatch.setattr(nlp, "installed_version",
                        lambda pkg: langcatalog.MODEL_VERSION if pkg == "es_core_news_sm" else None)
    monkeypatch.setattr(models, "_run_installer", lambda argv: pytest.fail("must not download"))
    nlp._models["es"] = object()
    models.install("es", "sm")
    wait("es")
    assert models.state("es") == {"state": "idle", "message": ""}
    assert "es" not in nlp._models


@pytest.mark.parametrize("have", [{"es_core_news_md": "3.8.0"}, {"es_core_news_sm": "3.7.1"}])
def test_install_downloads_when_other_size_or_version_is_installed(mdir, monkeypatch, have):
    monkeypatch.setattr(nlp, "installed_version", lambda pkg: have.get(pkg))
    calls = []
    monkeypatch.setattr(models, "_run_installer", fake_ok(calls))
    models.install("es", "sm")
    wait("es")
    assert len(calls) == 1 and models.state("es")["state"] == "idle"
