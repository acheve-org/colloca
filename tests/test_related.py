"""Related terms from word vectors (T21)."""
# ruff: noqa: E501
import random

import numpy as np
import pytest
import spacy

from corpora import related

from .test_api import make_corpus

ANIMALS = ["perro", "gato", "caballo", "conejo"]
VEHICLES = ["coche", "camión", "autobús", "furgón"]
ANIMAL_CTX = ["come carne fresca", "duerme cerca del jardín", "tiene mucho pelo suave", "corre por el campo verde"]
VEHICLE_CTX = ["tiene cuatro ruedas grandes", "consume mucha gasolina cara", "circula por la carretera ancha",
               "necesita un motor potente"]


def text(n: int = 500, seed: int = 1) -> str:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        if rng.random() < 0.5:
            out.append(f"El {rng.choice(ANIMALS)} {rng.choice(ANIMAL_CTX)}.")
        else:
            out.append(f"El {rng.choice(VEHICLES)} {rng.choice(VEHICLE_CTX)}.")
    return " ".join(out)


@pytest.fixture(scope="module")
def sequences():
    rng = random.Random(3)
    seqs = []
    for _ in range(300):
        words = rng.choice([ANIMALS, VEHICLES])
        ctx = rng.choice(ANIMAL_CTX if words is ANIMALS else VEHICLE_CTX).split()
        seqs.append([rng.choice(words), *ctx])
    return seqs


# --------------------------------------------------------------------------- the method
def test_words_in_the_same_contexts_are_neighbours(sequences):
    emb = related.train(sequences, {})
    assert emb is not None
    near = [n["item"] for n in emb.neighbours("gato", 6)]
    assert set(near[:3]) == {"perro", "caballo", "conejo"}                    # animals before anything else
    assert emb.neighbours("gato", 1)[0]["similarity"] > emb.neighbours("gato", 8)[-1]["similarity"]
    other = [n["item"] for n in emb.neighbours("coche", 3)]
    assert set(other) == {"camión", "autobús", "furgón"}


def test_neighbours_exclude_the_word_itself_and_obey_the_pos_filter(sequences):
    emb = related.train(sequences, {"perro": "NOUN", "gato": "NOUN", "come": "VERB"})
    assert "gato" not in [n["item"] for n in emb.neighbours("gato", 50)]
    assert all(n["pos"] == "NOUN" for n in emb.neighbours("gato", 20, {"NOUN"}))
    assert emb.neighbours("gato", 20, {"ADJ"}) == []


def test_vectors_are_unit_length_and_training_is_deterministic(sequences):
    a, b = related.train(sequences, {}), related.train(sequences, {})
    assert np.allclose(np.linalg.norm(a.vectors, axis=1), 1.0, atol=1e-4)
    assert a.lemmas == b.lemmas and np.allclose(a.vectors, b.vectors)


def test_too_little_text_gives_nothing():
    assert related.train([["uno", "dos", "tres"]], {}) is None
    assert related.train([], {}) is None


def test_pairs_do_not_cross_document_boundaries():
    # the last words of one document and the first of the next must not count as company
    one = ["alfa", "beta", "c1", "c2", "c3", "c4"] * 3
    two = ["omega", "gamma", "d1", "d2", "d3", "d4"] * 3
    emb = related.train([one, two] * 4, {}, min_freq=1)
    assert emb is not None
    sim = emb.vectors[emb.index["alfa"]] @ emb.vectors[emb.index["omega"]]
    same = emb.vectors[emb.index["alfa"]] @ emb.vectors[emb.index["beta"]]
    assert same > sim


# --------------------------------------------------------------------------- the model source
def test_model_neighbours_come_from_the_vectors_of_the_model():
    nlp = spacy.blank("es")
    for word, vec in {"perro": [1, 0.1, 0], "gato": [0.9, 0.2, 0], "caballo": [0.8, 0.3, 0.1], "coche": [0, 0.1, 1],
                      "Madrid": [0.9, 0.1, 0.05], "123": [0.9, 0.15, 0]}.items():
        nlp.vocab.set_vector(word, np.array(vec, dtype="float32"))
    got = related.model_neighbours(nlp, "perro", 5)
    assert [g["item"] for g in got][:2] == ["gato", "caballo"]
    assert "Madrid" not in [g["item"] for g in got] and "123" not in [g["item"] for g in got]    # words only, lower case
    assert all(g["freq"] is None and g["pos"] == "" for g in got)
    assert related.model_neighbours(nlp, "desconocida", 5) is None
    assert related.model_neighbours(spacy.blank("es"), "perro", 5) is None                   # no vectors at all


# --------------------------------------------------------------------------- the endpoint
@pytest.fixture()
def cid(client):
    related._cache.clear()
    c = make_corpus(client, "es", "animales y coches")
    r = client.post(f"/api/corpora/{c}/documents", json={"title": "texto", "text": text()})
    assert r.status_code in (200, 201, 202)
    return c


def ask(client, cid, **params):
    return client.get(f"/api/corpora/{cid}/related", params=params)


def test_related_terms_from_the_corpus(client, cid):
    r = ask(client, cid, q="gato").json()
    assert r["query"] == "gato"
    info = r["sources"]["corpus"]
    assert info["trained"] and info["known"] and info["small"] is True and info["tokens"] > 1000
    near = [n["item"] for n in r["related"]["corpus"]]
    # the other animals come up; a word that shares its contexts with them (carne, pelo) may too, a vehicle does not
    assert {"perro", "caballo", "conejo"} <= set(near[:6])
    assert not set(near[:6]) & set(VEHICLES)
    first = r["related"]["corpus"][0]
    assert set(first) == {"item", "pos", "similarity", "freq"} and first["freq"] > 0 and first["pos"]


def test_the_word_is_a_lemma_in_any_case_and_pos_filters(client, cid):
    assert ask(client, cid, q="  GATO ").json()["related"]["corpus"]
    nouns = ask(client, cid, q="gato", pos="NOUN").json()["related"]["corpus"]
    assert nouns and all(n["pos"] == "NOUN" for n in nouns)
    assert ask(client, cid, q="gato", pos="ADJ,ADV").json()["related"]["corpus"] == [] or \
        all(n["pos"] in ("ADJ", "ADV") for n in ask(client, cid, q="gato", pos="ADJ,ADV").json()["related"]["corpus"])


def test_an_unknown_or_rare_word_says_why(client, cid):
    info = ask(client, cid, q="zzzz").json()["sources"]["corpus"]
    assert info["known"] is False and "too rare" in info["reason"]
    assert ask(client, cid, q="zzzz").json()["related"]["corpus"] == []


def test_a_corpus_with_little_text_says_so(client):
    related._cache.clear()
    c = make_corpus(client, "es", "pequeño")
    client.post(f"/api/corpora/{c}/documents", json={"title": "t", "text": "El perro come carne. El gato duerme mucho."})
    info = ask(client, c, q="perro").json()["sources"]["corpus"]
    assert info["trained"] is False and "too little text" in info["reason"]


def test_the_model_source_reports_what_the_installed_model_can_do(client, cid):
    r = ask(client, cid, q="gato", source="model").json()
    assert "corpus" not in r["related"] and r["sources"]["model"]["known"] is False
    assert "no word vectors" in r["sources"]["model"]["reason"] or r["sources"]["model"]["available"]


def test_both_sources(client, cid):
    r = ask(client, cid, q="gato", source="both").json()
    assert set(r["related"]) == {"corpus", "model"} and set(r["sources"]) == {"corpus", "model"}


def test_cached_vectors_are_reused_and_follow_the_corpus(client, cid):
    ask(client, cid, q="gato")
    assert len(related._cache) == 1
    ask(client, cid, q="perro")
    assert len(related._cache) == 1                                       # the same training
    client.post(f"/api/corpora/{cid}/documents", json={"title": "otro", "text": text(80, seed=9)})
    ask(client, cid, q="gato")
    assert len(related._cache) == 2                                       # the corpus changed: trained again


def test_the_document_filter_applies(client, cid):
    r = ask(client, cid, q="gato", docs="999999").json()
    assert r["sources"]["corpus"]["trained"] is False


def test_validation(client, cid):
    assert ask(client, cid, q="gato", source="web").status_code == 400
    assert ask(client, cid, q="   ").status_code == 400
    assert ask(client, 99999, q="gato").status_code == 404
    assert ask(client, cid, q="gato", limit=0).status_code == 422


def test_nothing_is_added_to_the_termbase(client, cid):
    before = client.get("/api/terms").json()
    ask(client, cid, q="gato", source="both")
    assert client.get("/api/terms").json() == before
