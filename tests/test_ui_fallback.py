import os
import subprocess
import sys

import colloca.main as main


def test_root_explains_missing_ui(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "STATIC", str(tmp_path))
    r = client.get("/")
    assert r.status_code == 503
    assert "mise run ui:build" in r.text


def test_root_serves_index_when_present(client, monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("<html>hello ui</html>")
    monkeypatch.setattr(main, "STATIC", str(tmp_path))
    r = client.get("/")
    assert r.status_code == 200
    assert "hello ui" in r.text


def test_static_dir_env_override(tmp_path):
    # A fresh interpreter: reloading main in-process would replace the app other tests use.
    env = {**os.environ, "COLLOCA_STATIC_DIR": str(tmp_path)}
    code = "import colloca.main as m; print(m.STATIC)"
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
    assert out.stdout.strip() == str(tmp_path)
    assert main.STATIC.endswith("static")
