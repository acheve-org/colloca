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
