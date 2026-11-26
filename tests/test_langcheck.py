import pytest

from corpora import langcheck, languages

from .test_api import ES_TEXT, IT_TEXT

EN_TEXT = ("The translator reviews the terminology of the client and all the technical documents "
           "should be consistent across every file that is delivered to the customer on time.")


def test_accepts_matching_language():
    assert langcheck.check(ES_TEXT, "es")["verdict"] == "ok"
    assert langcheck.check(IT_TEXT, "it")["verdict"] == "ok"


def test_flags_the_other_language():
    r = langcheck.check(IT_TEXT, "es")
    assert r["verdict"] == "mismatch" and r["detected"] == "it"
    r = langcheck.check(ES_TEXT, "it")
    assert r["verdict"] == "mismatch" and r["detected"] == "es"


def test_unrelated_language_is_uncertain_not_rejected():
    assert langcheck.check(EN_TEXT, "es")["verdict"] == "uncertain"


def test_short_text_is_never_judged():
    assert langcheck.check("Il gatto dorme.", "es")["verdict"] == "short"


FR_TEXT = ("Le traducteur vérifie la terminologie du client et tous les documents techniques doivent être cohérents "
           "dans chaque fichier que nous avons livré à nos clients avant la date prévue pour cette commande.")


@pytest.fixture()
def with_languages(client):
    added = []

    def add(*codes):
        for code in codes:
            languages.add(code, code.upper(), None, "")
            added.append(code)
    yield add
    for code in added:
        languages.remove(code)


def test_single_configured_language_never_rejects(monkeypatch):
    monkeypatch.setattr(languages, "all_languages", lambda: [languages.Language("es", "Spanish", None, "spa")])
    r = langcheck.check(IT_TEXT, "es")
    assert r["verdict"] == "ok" and r["detected"] is None


def test_third_language_detected(with_languages):
    with_languages("fr")
    r = langcheck.check(FR_TEXT, "es")
    assert r["verdict"] == "mismatch" and r["detected"] == "fr"


def test_unconfigured_language_is_uncertain_not_rejected():
    # English shares no distinctive words with es/it; French text is not rejected from a Spanish corpus
    assert langcheck.check(EN_TEXT, "es")["verdict"] == "uncertain"
    assert langcheck.check(EN_TEXT, "it")["verdict"] == "uncertain"
    assert langcheck.check(FR_TEXT, "es")["verdict"] != "mismatch"


def test_overlapping_stop_words_do_not_reject_correct_text(with_languages):
    with_languages("pt", "ca")
    assert langcheck.check(ES_TEXT, "es")["verdict"] == "ok"
    assert langcheck.check(IT_TEXT, "it")["verdict"] == "ok"
