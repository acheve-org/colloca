from colloca import langcheck

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
