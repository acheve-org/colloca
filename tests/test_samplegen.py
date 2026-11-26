from corpora import analysis, db, samplegen


def _make(tmp_path, name, **kw):
    conn = db.connect(str(tmp_path / name))
    db.migrate(conn)
    cid = conn.execute("INSERT INTO corpora (name,lang) VALUES ('s',?)", (kw.get("lang", "es"),)).lastrowid
    samplegen.generate(conn, cid, kw.pop("lang", "es"), **kw)
    return conn, cid


def test_size_and_shape(tmp_path):
    conn, cid = _make(tmp_path, "a.db", words=5000, n_docs=4)
    assert analysis.corpus_size(conn, cid) == 5000
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 4
    freq = analysis.frequency(conn, cid, unit="form", exclude_stop=False, limit=50)
    assert freq[0]["freq"] > 5 * freq[-1]["freq"]          # steep, Zipf-like head
    assert conn.execute("SELECT COUNT(*) FROM tokens WHERE upos='PUNCT' AND alpha=0").fetchone()[0] > 0


def test_deterministic(tmp_path):
    rows = []
    for name, seed in (("a.db", 3), ("b.db", 3), ("c.db", 4)):
        conn, _ = _make(tmp_path, name, lang="it", words=2000, seed=seed)
        rows.append(conn.execute("SELECT form,lemma,upos,sent FROM tokens ORDER BY doc_id,pos").fetchall())
    assert [tuple(r) for r in rows[0]] == [tuple(r) for r in rows[1]]
    assert [tuple(r) for r in rows[0]] != [tuple(r) for r in rows[2]]
