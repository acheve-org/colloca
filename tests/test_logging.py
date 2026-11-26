import json
import logging
import time

from corpora import importer, logsetup


def test_timer_logs_only_slow_blocks(monkeypatch, caplog):
    monkeypatch.setenv("CORPORA_SLOW_MS", "20")
    with caplog.at_level(logging.WARNING, logger="corpora.timing"):
        with logsetup.timer("fast"):
            pass
        with logsetup.timer("slow thing"):
            time.sleep(0.05)
    assert [r.getMessage().split(" took")[0] for r in caplog.records] == ["Slow: slow thing"]


def test_timer_off_with_zero(monkeypatch, caplog):
    monkeypatch.setenv("CORPORA_SLOW_MS", "0")
    with caplog.at_level(logging.WARNING, logger="corpora.timing"), logsetup.timer("x"):
        time.sleep(0.01)
    assert not caplog.records


def test_json_format_and_level(monkeypatch):
    monkeypatch.setenv("CORPORA_LOG_LEVEL", "debug")
    monkeypatch.setenv("CORPORA_LOG_FORMAT", "json")
    logsetup.configure()
    log = logging.getLogger("corpora")
    assert log.level == logging.DEBUG
    handler = next(h for h in log.handlers if getattr(h, "_corpora", False))
    rec = logging.LogRecord("corpora.x", logging.INFO, "f", 1, "hello %s", ("w",), None)
    assert json.loads(handler.format(rec))["message"] == "hello w"
    monkeypatch.delenv("CORPORA_LOG_FORMAT")
    monkeypatch.delenv("CORPORA_LOG_LEVEL")
    logsetup.configure()


def test_job_lifecycle_is_logged(caplog):
    caplog.set_level(logging.INFO, logger="corpora.importer")
    job = importer.Job(99, 1, "import", "x.txt")
    importer._run(job, lambda j: {"ok": 1})

    def reject(_job):
        raise importer.ImportRejected(400, "no", "bad")

    importer._run(importer.Job(100, 1, "import", "bad"), reject)
    msgs = [r.getMessage() for r in caplog.records]
    assert any("Job 99 started" in m for m in msgs) and any("Job 99 done" in m for m in msgs)
    assert any("Job 100 rejected (bad)" in m for m in msgs)
