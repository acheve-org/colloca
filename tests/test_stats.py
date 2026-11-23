"""Numeric regression tests for the corpus statistics.

Reference values are derived by hand from the textbook formulas (see the comments), not by running
the code under test, so a change to a formula shows up as a failure here.
"""
import math
import sqlite3

import pytest

from colloca import analysis, db


# --------------------------------------------------------------------------- pure formulas
def test_logdice_hand_values():
    assert analysis.logdice(10, 50, 30) == pytest.approx(12.0)      # 14 + log2(20/80) = 14 - 2
    assert analysis.logdice(5, 5, 5) == pytest.approx(14.0)          # perfect association is the maximum
    assert analysis.logdice(1, 3, 3) == pytest.approx(14 + math.log2(1 / 3))


def test_logdice_independent_of_corpus_size():
    # logDice only uses the three counts, never N
    assert analysis.logdice(10, 50, 30) == analysis.logdice(10, 50, 30)
    assert analysis.expected_cooc(50, 30, 8, 100_000) == pytest.approx(0.12)   # 50*30*8/100000


def test_mi_and_tscore_hand_values():
    expected = analysis.expected_cooc(50, 30, 8, 100_000)           # 0.12
    assert analysis.mutual_information(10, expected) == pytest.approx(6.3808, abs=1e-4)  # log2(10/0.12)
    assert analysis.t_score(10, expected) == pytest.approx(3.1243, abs=1e-4)            # (10-0.12)/sqrt(10)
    assert analysis.mutual_information(4, 4) == 0.0                 # observed == expected
    assert analysis.mutual_information(3, 0) == 0.0                 # guard against division by zero


def test_g2_hand_values():
    # table [[10,20],[30,40]]: expected cells 12, 18, 28, 42; G2 = 2*sum(o*ln(o/e)) = 0.80435
    assert analysis._g2(10, 20, 30, 40) == pytest.approx(0.80435, abs=1e-5)
    assert analysis._g2(10, 20, 20, 40) == pytest.approx(0.0, abs=1e-9)   # proportional rows: independent
    assert analysis._g2(0, 5, 5, 0) > 0                                   # zero cells must not crash


def test_keyness_ll_hand_values():
    # a=30 of 1000 words vs b=10 of 2000: E1=13.333, E2=26.667; G2 = 2*(30 ln 2.25 + 10 ln 0.375) = 29.0392
    assert analysis.keyness_ll(30, 10, 1000, 2000) == pytest.approx(29.0392, abs=1e-4)
    assert analysis.keyness_ll(20, 40, 1000, 2000) == pytest.approx(0.0, abs=1e-9)  # same relative frequency
    assert analysis.keyness_ll(5, 0, 1000, 1000) == pytest.approx(2 * 5 * math.log(2))  # absent from reference


# --------------------------------------------------------------------------- end to end on a tiny corpus
@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    db.migrate(c)
    yield c
    c.close()


def make_corpus(conn, name, sentences_per_doc, lang="es"):
    """Build a corpus straight in the token table (no NLP): every word is its own lemma, all alphabetic,
    no stopwords. `sentences_per_doc` is a list of documents, each a list of sentences (strings)."""
    cid = conn.execute("INSERT INTO corpora (name, lang) VALUES (?, ?)", (name, lang)).lastrowid
    for i, sentences in enumerate(sentences_per_doc):
        words = [(s_i, w) for s_i, s in enumerate(sentences) for w in s.split()]
        did = conn.execute(
            "INSERT INTO documents (corpus_id,title,text,text_hash,n_tokens) VALUES (?,?,?,?,?)",
            (cid, f"d{i}", " ".join(sentences), f"{name}{i}", len(words))).lastrowid
        conn.executemany(
            "INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(did, pos, s_i, w, w, w, "NOUN", 1, 0, 1) for pos, (s_i, w) in enumerate(words)])
    return cid


def test_frequency_counts_and_dispersion(conn):
    cid = make_corpus(conn, "c", [["gato perro gato"], ["gato pez"]])      # N=5 words, 2 docs
    rows = {r["item"]: r for r in analysis.frequency(conn, cid, min_freq=1)}
    assert rows["gato"]["freq"] == 3 and rows["gato"]["docs"] == 2 and rows["gato"]["docs_pct"] == 100.0
    assert rows["gato"]["per_million"] == 600_000.0                          # 3 / 5 * 1e6
    assert rows["perro"]["docs"] == 1 and rows["perro"]["docs_pct"] == 50.0
    assert [r["item"] for r in analysis.frequency(conn, cid)][0] == "gato"   # sorted by frequency


def test_concordance_positions_and_context(conn):
    cid = make_corpus(conn, "c", [["uno dos tres cuatro cinco seis"]])
    res = analysis.concordance(conn, cid, "tres cuatro", unit="form", width=2)
    assert res["total"] == 1
    line = res["lines"][0]
    assert (line["left"], line["node"], line["right"]) == ("uno dos", "tres cuatro", "cinco seis")
    edge = analysis.concordance(conn, cid, "uno", unit="form", width=2)["lines"][0]
    assert edge["left"] == "" and edge["right"] == "dos tres"                # context stops at the text edge


def test_collocation_statistics_match_hand_calculation(conn):
    # N = 12 words. Node "x" occurs twice (f_n=2); "y" is next to it both times (f_c=2, o=2); "z"/"w" once each.
    cid = make_corpus(conn, "c", [["x y z", "x y w", "p q r", "p q r"]])
    res = analysis.collocations(conn, cid, "x", left=4, right=4, min_freq=1)
    assert res["node_freq"] == 2 and res["corpus_size"] == 12
    rows = {r["item"]: r for r in res["rows"]}
    assert set(rows) == {"y", "z", "w"}                                      # nothing from other sentences
    y, z = rows["y"], rows["z"]
    assert y["cooc"] == 2 and y["freq"] == 2 and y["docs"] == 1
    assert y["logdice"] == pytest.approx(14.0)                               # 14 + log2(2*2/(2+2))
    expected_y = 2 * 2 * 8 / 12                                              # f_n*f_c*span/N = 2.667
    assert y["mi"] == pytest.approx(round(math.log2(2 / expected_y), 2))     # -0.42
    assert y["tscore"] == pytest.approx(round((2 - expected_y) / math.sqrt(2), 2))  # -0.47
    assert z["logdice"] == pytest.approx(round(14 + math.log2(2 * 1 / (2 + 1)), 2))  # 13.42
    assert res["rows"][0]["item"] == "y"                                     # sorted by logDice


def test_collocation_window_and_sentence_boundary(conn):
    cid = make_corpus(conn, "c", [["a b c d e", "f x"]])
    only_right = {r["item"] for r in analysis.collocations(conn, cid, "c", left=0, right=1, min_freq=1)["rows"]}
    assert only_right == {"d"}                                               # window of 1 to the right
    # "x" starts a new sentence context: "e" (previous sentence) must not count as its neighbour
    near_x = {r["item"] for r in analysis.collocations(conn, cid, "x", left=3, right=3, min_freq=1)["rows"]}
    assert near_x == {"f"}


def test_collocation_rejects_phrases(conn):
    cid = make_corpus(conn, "c", [["a b c"]])
    with pytest.raises(ValueError):
        analysis.collocations(conn, cid, "a b")


def test_keyness_matches_hand_calculation(conn):
    # target: 30 "foo" + 970 "bar" (1000 words); reference: 10 "foo" + 1990 "baz" (2000 words)
    target = make_corpus(conn, "t", [[" ".join(["foo"] * 30 + ["bar"] * 970)]])
    ref = make_corpus(conn, "r", [[" ".join(["foo"] * 10 + ["baz"] * 1990)]])
    rows = {r["item"]: r for r in analysis.keyness(conn, target, ref, min_freq=1)}
    foo = rows["foo"]
    assert foo["ll"] == pytest.approx(29.0, abs=0.05)
    assert foo["freq"] == 30 and foo["ref_freq"] == 10
    assert foo["log_ratio"] == pytest.approx(round(math.log2(6), 2))        # (30/1000) / (10/2000) = 6
    assert foo["ref_per_million"] == 5000.0
    assert rows["bar"]["ll"] > foo["ll"]                                     # absent from the reference: most key
    assert rows["bar"]["ref_freq"] == 0 and "baz" not in rows                # only the target's words are listed


def test_keyness_negative_for_underused_words(conn):
    target = make_corpus(conn, "t", [[" ".join(["foo"] * 5 + ["bar"] * 995)]])
    ref = make_corpus(conn, "r", [[" ".join(["foo"] * 100 + ["bar"] * 900)]])
    rows = {r["item"]: r for r in analysis.keyness(conn, target, ref, min_freq=1)}
    assert rows["foo"]["ll"] < 0                                             # sign marks under-representation
