"""Advanced query language (T13): regex, lemma/POS, gaps, alternatives, accent-insensitive, errors, limits."""
import sqlite3

import pytest

from corpora import analysis, cql, db

from .test_api import add, make_corpus

TEXT = ("Tomamos una decisión rápida. Tomó el café con leche. El café está caliente. "
        "Ayer tomaron medidas importantes. Los contratos de trabajo son largos. La contratación es lenta. "
        "Me gusta el cafe sin acento. El contrato termina hoy. Ella toma el autobús. Cayó una gota de agua.")


@pytest.fixture()
def cid(client):
    c = make_corpus(client, "es", "advanced")
    assert add(client, c, TEXT).status_code in (200, 201, 202)
    return c


def adv(client, cid, q, **params):
    return client.get(f"/api/corpora/{cid}/concordance", params={"q": q, "advanced": "true", **params})


def nodes(r):
    assert r.status_code == 200, r.text
    return [ln["node"].lower() for ln in r.json()["lines"]]


# ----------------------------------------------------------------- tokens and conditions
def test_lemma_condition_finds_every_form(client, cid):
    res = nodes(adv(client, cid, '[lemma="tomar"]'))
    assert {"tomamos", "tomó", "tomaron", "toma"} <= set(res)


def test_form_condition_is_the_written_word(client, cid):
    assert nodes(adv(client, cid, '[form="toma"]')) == ["toma"]
    assert nodes(adv(client, cid, '[word="contrato"]')) == ["contrato"]


def test_regex_on_form_and_lemma(client, cid):
    assert set(nodes(adv(client, cid, '[form="contrat.*"]'))) >= {"contratos", "contratación", "contrato"}
    assert set(nodes(adv(client, cid, '[lemma="tom(ar|a)"]'))) >= {"tomamos", "toma"}
    assert nodes(adv(client, cid, '[form="contrato"]')) == ["contrato"]       # the regex must match the whole word


def test_friendly_regex_token(client, cid):
    res = nodes(adv(client, cid, "/contrat(o|os)/"))
    assert sorted(res) == ["contrato", "contratos"]


def test_alternatives_inside_a_condition_and_bare(client, cid):
    assert sorted(nodes(adv(client, cid, '[form="contrato"|form="contratos"]'))) == ["contrato", "contratos"]
    assert sorted(nodes(adv(client, cid, "contrato|contratos", unit="form"))) == ["contrato", "contratos"]
    assert sorted(nodes(adv(client, cid, '[form="contrato|contratos"]'))) == ["contrato", "contratos"]


def test_and_between_attributes(client, cid):
    res = adv(client, cid, '[lemma="tomar" & pos="VERB"]').json()
    assert res["total"] >= 3
    assert adv(client, cid, '[lemma="tomar" & pos="NOUN"]').json()["total"] == 0


def test_not_equal(client, cid):
    res = nodes(adv(client, cid, '[lemma="tomar" & form!="toma"]'))
    assert "toma" not in res and "tomamos" in res


def test_pos_tag_in_friendly_form(client, cid):
    res = adv(client, cid, "tomar NOUN").json()
    assert any(ln["node"].lower().startswith("toma") for ln in res["lines"])


def test_wildcard_in_the_friendly_form(client, cid):
    assert sorted(set(nodes(adv(client, cid, "contrat*", unit="form")))) == ["contratación", "contrato", "contratos"]


def test_quoted_word_is_literal(client, cid):
    assert nodes(adv(client, cid, '"toma"', unit="form")) == ["toma"]


# ----------------------------------------------------------------- gaps
def test_gap_with_bracket_syntax(client, cid):
    res = adv(client, cid, '[lemma="tomar"] []{0,3} [pos="NOUN"]').json()
    assert any("decisión" in ln["node"].lower() for ln in res["lines"])
    assert res["parsed"].startswith('lemma "tomar", then 0 to 3 words, then a noun')


def test_gap_friendly_syntax_is_equivalent(client, cid):
    a = adv(client, cid, '[lemma="tomar"] []{0,3} [pos="NOUN"]').json()
    b = adv(client, cid, "tomar +3 NOUN").json()
    assert [ln["node"] for ln in a["lines"]] == [ln["node"] for ln in b["lines"]] and a["total"] > 0


def test_exact_gap_and_gap_range(client, cid):
    assert nodes(adv(client, cid, '"tomó" [] café', unit="form")) == ["tomó el café"]
    assert nodes(adv(client, cid, '"tomó" +1-1 café', unit="form")) == ["tomó el café"]
    assert nodes(adv(client, cid, '"tomó" +2-3 café', unit="form")) == []     # café is only one word away
    assert nodes(adv(client, cid, '"tomó" café', unit="form")) == []          # adjacent means adjacent


def test_pattern_does_not_cross_sentences(client, cid):
    assert adv(client, cid, '"decisión" +15 "tomó"', unit="form").json()["total"] == 0


def test_anchor_can_be_in_the_middle_or_the_end(client, cid):
    assert nodes(adv(client, cid, '[pos="DET"] café', unit="form")) == ["el café", "el café"]
    assert nodes(adv(client, cid, '[pos="DET"] +3 "contratación"', unit="form")) == ["la contratación"]
    res = nodes(adv(client, cid, '[pos="NOUN"] [] "contratos"', unit="form"))
    assert all(r.endswith("contratos") for r in res)


def test_matches_mark_only_the_named_tokens(client, cid):
    ln = adv(client, cid, '"tomó" [] café', unit="form").json()["lines"][0]
    assert len(ln["matches"]) == 2 and ln["span"] == 3


# ----------------------------------------------------------------- accents and case
def test_accent_insensitive_in_both_syntaxes(client, cid):
    assert sorted(set(nodes(adv(client, cid, "cafe", unit="form")))) == ["cafe"]
    got = nodes(adv(client, cid, "cafe", unit="form", accent_insensitive="true"))
    assert sorted(got) == ["cafe", "café", "café"]
    simple = client.get(f"/api/corpora/{cid}/concordance",
                        params={"q": "cafe", "unit": "form", "accent_insensitive": "true"}).json()
    assert simple["total"] == 3 and "parsed" not in simple
    reg = nodes(adv(client, cid, '[form="caf.*"]', accent_insensitive="true"))
    assert len(reg) == 3 and "cafe" in reg


def test_accent_insensitive_lemma_and_pattern_with_accent(client, cid):
    assert len(nodes(adv(client, cid, '[lemma="decision"]', accent_insensitive="true"))) == 1
    assert len(nodes(adv(client, cid, '[form="decisión"]', accent_insensitive="true"))) == 1


def test_n_tilde_is_not_stripped():
    assert cql.strip_accents("Café ñandú Über çà") == "Cafe ñandu Uber ca"


def test_case_sensitive_in_advanced(client, cid):
    assert nodes(adv(client, cid, '[form="Tomamos"]', case_sensitive="true")) == ["tomamos"]
    assert adv(client, cid, '[form="tomamos"]', case_sensitive="true").json()["total"] == 0
    assert adv(client, cid, '[form="tomamos"]').json()["total"] == 1


def test_case_sensitive_with_accent_is_rejected(client, cid):
    r = adv(client, cid, "cafe", case_sensitive="true", accent_insensitive="true")
    assert r.status_code == 400


# ----------------------------------------------------------------- the query in words
def test_parsed_query_in_words():
    q = cql.parse('[lemma="tomar" & pos="VERB"] +1-3 [pos="NOUN|PROPN"]', accent_insensitive=True)
    assert cql.describe(q) == ('lemma "tomar" and part of speech verb, then 1 to 3 words, '
                               "then a noun or proper noun (accents ignored)")
    assert cql.describe(cql.parse('"aaa" [] "bbb"', "form")) == 'word "aaa", then exactly 1 word, then word "bbb"'
    assert cql.describe(cql.parse("contrat* NOUN")).endswith("then a noun")


def test_explain_endpoint(client):
    ok = client.get("/api/query/explain", params={"q": "tomar +3 NOUN", "advanced": "true"}).json()
    assert ok == {"ok": True, "parsed": 'lemma "tomar", then 0 to 3 words, then a noun'}
    bad = client.get("/api/query/explain", params={"q": 'tomar [lemma="x"', "advanced": "true"}).json()
    assert bad["ok"] is False and bad["position"] == 7


# ----------------------------------------------------------------- errors with positions
@pytest.mark.parametrize("q, pos, text", [
    ('[lemma="tomar"', 1, "no closing ]"),
    ('[colour="x"]', 2, "Unknown attribute"),
    ('[lemma=tomar]', 8, "double quotes"),
    ('[lemma="tomar]', 8, "closing double quote"),
    ('[lemma="to(mar"]', 11, "Invalid regular expression"),
    ('[pos="NOUNS"]', 6, "not a part-of-speech tag"),
    ('[lemma="x"] []{0,3}', 13, "end with a gap"),
    ('[] tomar', 1, "start with a gap"),
    ('tomar []* NOUN', 9, "open-ended"),
    ('[]{1,3} NOUN', 1, "start with a gap"),
    ('tomar +99 NOUN', 7, "span"),
    ('tomar +x NOUN', 7, "number of words"),
    ('/abc', 1, "closing /"),
    ('contr*ato', 1, "can only start or end"),
    ('co* NOUN', 1, "at least 3 letters"),
    ('tomar||coger', 7, "empty alternative"),
    ('[lemma="tomar"]{1,2}', 16, "only follow []"),
    ('[lemma="tomar" lemma="x"]', 16, "Expected &"),
    ('[lemma="(a+)+b"]', 9, "repeats"),
])
def test_errors_point_at_the_mistake(q, pos, text):
    with pytest.raises(cql.QueryError) as e:
        cql.parse(q)
    assert e.value.position == pos, (q, e.value)
    assert text in e.value.message and f"(at character {pos})" in str(e.value)


def test_error_reaches_the_api_as_400_with_the_position(client, cid):
    r = adv(client, cid, '[lemma="x"] +99 NOUN')
    assert r.status_code == 400 and "at character" in r.json()["detail"]


def test_too_many_tokens():
    with pytest.raises(cql.QueryError, match="at most 6 tokens"):
        cql.parse("aaa bbb ccc ddd eee fff ggg")


# ----------------------------------------------------------------- queries that would scan everything
@pytest.mark.parametrize("q", ["NOUN", "NOUN +3 VERB", '[form=".*ado"]', '[form="ab.*"]',
                               '[lemma!="tomar"]', '[pos="NOUN"|lemma="tomar"]', "*miento", "/.*/",
                               "NOUN|contrato"])
def test_unanchored_queries_are_rejected(q):
    with pytest.raises(cql.QueryError, match="every word"):
        cql.parse(q)


def test_any_anchored_token_is_enough(client, cid):
    cql.parse('NOUN +2 [form="contrat.*"]')
    cql.parse('[lemma="tomar"|lemma="coger"]')


def test_any_order_cannot_combine_with_advanced(client, cid):
    assert adv(client, cid, "tomar café", any_order="true").status_code == 400


# ----------------------------------------------------------------- limits
def test_hit_cap_is_reported(client, cid, monkeypatch):
    monkeypatch.setattr(cql, "MAX_ROWS", 2)
    res = adv(client, cid, "[lemma=\"el\"]").json()
    assert res["capped"] is True and res["total"] == 2


def test_timeout_stops_the_query(client, cid, monkeypatch):
    monkeypatch.setattr(cql, "TIMEOUT_SECONDS", -1)
    monkeypatch.setattr(cql, "PROGRESS_STEPS", 1)
    r = adv(client, cid, '[form="contrat.*"] +3 [form=".*"]')
    assert r.status_code == 400 and "stopped" in r.json()["detail"]


def test_query_plan_starts_from_an_index(client, cid):
    for q in ('[form="contrat.*"] +3 [pos="NOUN"]', '[pos="DET"] [lemma="tomar"]'):
        sql, params, _ = cql.compile_sql(cql.parse(q), "1=1", [])
        with db.session() as conn:
            plan = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
        assert any("USING" in step and "idx_tokens" in step for step in plan), plan
        assert not any(step.startswith("SCAN t") for step in plan), plan
    assert "LIMIT" in sql


# ----------------------------------------------------------------- bilingual and the existing syntax
def test_simple_syntax_is_unchanged_without_advanced(client, cid):
    r = client.get(f"/api/corpora/{cid}/concordance", params={"q": "tomar"}).json()
    assert r["total"] >= 4 and "parsed" not in r


def test_bilingual_accepts_the_advanced_flag(client):
    es = make_corpus(client, "es", "es")
    r = client.get(f"/api/corpora/{es}/bilingual", params={"q": '[lemma="tomar"]', "advanced": "true"})
    assert r.status_code == 200


# ----------------------------------------------------------------- migration
def test_migration_v8_builds_the_accent_indexes_for_existing_tokens(tmp_path):
    conn = sqlite3.connect(tmp_path / "v7.db")
    conn.row_factory = sqlite3.Row
    cql.register(conn)
    for version, sql in db.MIGRATIONS[:7]:
        conn.executescript(f"BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;")
    conn.execute("INSERT INTO corpora (name, lang) VALUES ('c','es')")
    conn.execute("INSERT INTO documents (corpus_id,title,source,kind,text,text_hash) VALUES (1,'d','s','text','t','h')")
    conn.execute("INSERT INTO tokens VALUES (1,0,0,'Café','café','café','NOUN',1,0,0)")
    conn.commit()
    assert db.migrate(sqlite3.connect(tmp_path / "v7.db")) == db.SCHEMA_VERSION >= 8
    conn2 = sqlite3.connect(tmp_path / "v7.db")
    cql.register(conn2)
    plan = conn2.execute("EXPLAIN QUERY PLAN SELECT pos FROM tokens WHERE corpora_ascii(norm)=?", ("cafe",)).fetchall()
    assert "idx_tokens_norm_ascii" in str(plan)
    assert conn2.execute("SELECT pos FROM tokens WHERE corpora_ascii(norm)='cafe'").fetchall() == [(0,)]


def test_analysis_search_returns_the_parsed_query(client, cid):
    with db.session() as conn:
        hits, capped, parsed = analysis.search(conn, cid, "tomar +2 NOUN", advanced=True)
    assert hits and not capped and parsed == 'lemma "tomar", then 0 to 2 words, then a noun'
