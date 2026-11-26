"""TMX export of aligned corpora (T20): text, metadata, inline markup kept from an import, round trip."""
import pytest
from defusedxml import ElementTree as ET

from corpora import db, parallel

from .test_api import make_corpus, wait_for_jobs
from .test_parallel import build_pairs, import_tmx, tmx

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

# A memory whose segments carry TMX inline markup (formatting codes) on both sides.
MARKED = (b'<?xml version="1.0" encoding="UTF-8"?><tmx version="1.4"><header srclang="es" datatype="plaintext"/><body>'
          b'<tu><tuv xml:lang="es"><seg>Firme el <bpt i="1" type="bold">&lt;b&gt;</bpt>contrato<ept i="1">&lt;/b&gt;'
          b'</ept> hoy.</seg></tuv><tuv xml:lang="it"><seg>Firmi il <bpt i="1" type="bold">&lt;b&gt;</bpt>contratto'
          b'<ept i="1">&lt;/b&gt;</ept> oggi.</seg></tuv></tu>'
          b'<tu><tuv xml:lang="es"><seg>Una frase simple &amp; sin marcas.</seg></tuv>'
          b'<tuv xml:lang="it"><seg>Una frase semplice &amp; senza segni.</seg></tuv></tu>'
          b'<tu><tuv xml:lang="es"><seg>Pulse <ph x="1">{1}</ph> para seguir.</seg></tuv>'
          b'<tuv xml:lang="it"><seg>Premi <ph x="1">{1}</ph> per continuare.</seg></tuv></tu>'
          b'</body></tmx>')


def check_tmx14(root) -> None:
    """The structure the TMX 1.4b DTD requires (written from its content models; the official DTD file was not
    available to download here): tmx(header, body), header attributes, body(tu*), tu((prop|note)*, tuv+),
    tuv((prop|note)*, seg), seg containing text and the inline elements only."""
    assert root.tag == "tmx" and root.get("version") == "1.4"
    assert [c.tag for c in root] == ["header", "body"]
    header, body = root
    for attr in ("creationtool", "creationtoolversion", "segtype", "o-tmf", "adminlang", "srclang", "datatype"):
        assert header.get(attr), attr
    assert header.get("segtype") in {"block", "paragraph", "sentence", "phrase"}
    assert all(c.tag in {"note", "prop", "ude"} for c in header)
    for tu in body:
        assert tu.tag == "tu"
        kinds = [c.tag for c in tu]
        assert set(kinds) <= {"note", "prop", "tuv"} and "tuv" in kinds
        assert kinds == sorted(kinds, key=lambda k: k == "tuv")          # props/notes first, then the variants
        for c in tu:
            if c.tag == "prop":
                assert c.get("type") and len(c) == 0
            if c.tag == "tuv":
                assert c.get(XML_LANG)
                assert [x.tag for x in c if x.tag not in {"note", "prop"}] == ["seg"] and c[-1].tag == "seg"
                for el in c.find("seg").iter():
                    assert el.tag == "seg" or el.tag in {"bpt", "ept", "it", "ph", "hi", "ut", "sub"}


def export(client, cid, **params):
    return client.get(f"/api/corpora/{cid}/export-tmx", params=params)


@pytest.fixture()
def pair(client):
    es, it = make_corpus(client, "es", "ES side"), make_corpus(client, "it", "IT side")
    import_tmx(client, es, tmx(build_pairs()), partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    return es, it


def units(root):
    return [{t.get(XML_LANG): "".join(t.find("seg").itertext()) for t in tu.findall("tuv")} for tu in root.find("body")]


def test_export_is_a_valid_tmx_with_every_pair(client, pair):
    es, it = pair
    r = export(client, es)
    assert r.status_code == 200 and "tmx" in r.headers["content-type"]
    assert r.headers["content-disposition"].endswith('.tmx"') and "ES-side" in r.headers["content-disposition"]
    root = ET.fromstring(r.content)
    check_tmx14(root)
    assert root.find("header").get("srclang") == "es"
    got = units(root)
    assert len(got) == len(build_pairs()) == int(r.headers["x-corpora-units"])
    assert [(u["es"], u["it"]) for u in got] == [(a, b) for a, b in build_pairs()]


def test_the_partner_corpus_is_the_target_and_the_source_can_be_either_side(client, pair):
    es, it = pair
    back = ET.fromstring(export(client, it).content)
    assert back.find("header").get("srclang") == "it"
    assert [(u["it"], u["es"]) for u in units(back)] == [(a, b) for b, a in build_pairs()]


def test_documents_metadata_travels_as_properties(client, pair):
    es, _ = pair
    docs = client.get(f"/api/corpora/{es}/documents").json()
    client.patch(f"/api/documents/{docs[0]['id']}", json={"tags": "legal, 2023", "text_type": "contract",
                                                          "doc_date": "2023-05", "author": "Acme"})
    root = ET.fromstring(export(client, es).content)
    props = {p.get("type"): p.text for p in root.find("body")[0].findall("prop")}
    assert props["x-document"] == docs[0]["title"] and props["x-text-type"] == "contract"
    assert props["x-date"] == "2023-05" and props["x-author"] == "Acme" and props["x-tags"] == "2023, legal"
    check_tmx14(root)


def test_special_characters_are_escaped(client):
    es, it = make_corpus(client, "es", "esc"), make_corpus(client, "it", "esc it")
    import_tmx(client, es, tmx([("Cláusula <5> & «comillas» “dobles”", "Clausola <5> & «virgolette»")]),
               partner_corpus_id=it)
    wait_for_jobs(client, es)
    root = ET.fromstring(export(client, es).content)
    assert units(root)[0] == {"es": "Cláusula <5> & «comillas» “dobles”", "it": "Clausola <5> & «virgolette»"}


def test_inline_markup_of_an_imported_tmx_is_kept_and_written_back(client):
    es, it = make_corpus(client, "es", "tags"), make_corpus(client, "it", "tags it")
    import_tmx(client, es, MARKED, partner_corpus_id=it)
    assert wait_for_jobs(client, es)[0]["status"] == "done"
    # searches see plain text...
    text = client.get(f"/api/corpora/{es}/documents").json()[0]
    assert text["segmented"] == 1
    hits = client.get(f"/api/corpora/{es}/concordance", params={"q": "contrato", "unit": "form"}).json()
    assert hits["total"] == 1 and "<b>" not in hits["lines"][0]["left"] + hits["lines"][0]["right"]
    # ... the export gives the codes back
    r = export(client, es)
    root = ET.fromstring(r.content)
    check_tmx14(root)
    segs = [tu.findall("tuv")[0].find("seg") for tu in root.find("body")]
    assert [c.tag for c in segs[0]] == ["bpt", "ept"] and segs[0].find("bpt").text == "<b>"
    assert [c.tag for c in segs[2]] == ["ph"] and segs[2].find("ph").get("x") == "1"
    assert [c.tag for c in segs[1]] == []                       # a plain segment stays plain
    assert "".join(segs[1].itertext()) == "Una frase simple & sin marcas."
    # markup=false gives plain text
    plain = ET.fromstring(export(client, es, markup="false").content)
    assert all(len(tu.findall("tuv")[0].find("seg")) == 0 for tu in plain.find("body"))
    assert "".join(plain.find("body")[0].findall("tuv")[0].find("seg").itertext()) == "Firme el contrato hoy."


def test_round_trip_gives_the_same_segments_and_markup(client):
    es, it = make_corpus(client, "es", "rt"), make_corpus(client, "it", "rt it")
    import_tmx(client, es, MARKED, partner_corpus_id=it)
    wait_for_jobs(client, es)
    first = export(client, es).content
    es2, it2 = make_corpus(client, "es", "rt2"), make_corpus(client, "it", "rt2 it")
    import_tmx(client, es2, first, "again.tmx", partner_corpus_id=it2)
    assert wait_for_jobs(client, es2)[0]["status"] == "done"
    second = export(client, es2).content
    a, b = ET.fromstring(first), ET.fromstring(second)
    assert units(a) == units(b)
    tags = lambda root: [[c.tag for c in tuv.find("seg")] for tu in root.find("body") for tuv in tu.findall("tuv")]  # noqa: E731
    assert tags(a) == tags(b)


def test_pairs_read_back_by_the_importer_match_the_export(client, pair):
    es, _ = pair
    pairs, skipped = parallel.read_tmx(export(client, es).content, "es", "it")
    assert pairs == build_pairs() and skipped == 0


def test_partner_choice_and_errors(client, pair):
    es, it = pair
    other = make_corpus(client, "it", "second partner")
    import_tmx(client, es, tmx([("Un texto distinto para otro socio.", "Un testo diverso per un altro socio.")]),
               "other.tmx", partner_corpus_id=other)
    wait_for_jobs(client, es)
    assert client.get(f"/api/corpora/{es}/aligned-partners").json() == [
        {"id": it, "name": "IT side", "lang": "it", "docs": 1},
        {"id": other, "name": "second partner", "lang": "it", "docs": 1}]
    amb = export(client, es)
    assert amb.status_code == 400 and "partner_corpus_id" in amb.json()["detail"]
    only = ET.fromstring(export(client, es, partner_corpus_id=other).content)
    assert len(units(only)) == 1
    assert export(client, es, partner_corpus_id=12345).status_code == 400
    lonely = make_corpus(client, "es", "no aligned")
    assert export(client, lonely).status_code == 409
    assert export(client, 99999).status_code == 404


def test_the_document_filter_narrows_the_export(client, pair):
    es, _ = pair
    docs = client.get(f"/api/corpora/{es}/documents").json()
    assert export(client, es, docs="999999").status_code == 409          # no document matches the filter
    full = ET.fromstring(export(client, es, docs=str(docs[0]["id"])).content)
    assert len(units(full)) == len(build_pairs())


def test_a_document_in_the_trash_is_not_exported(client, pair):
    es, it = pair
    doc = client.get(f"/api/corpora/{es}/documents").json()[0]
    assert client.delete(f"/api/documents/{doc['id']}").status_code in (200, 204)
    assert export(client, es).status_code == 409
    assert client.get(f"/api/corpora/{es}/aligned-partners").json() == []


def test_markup_rows_follow_their_document(client):
    es, it = make_corpus(client, "es", "gone"), make_corpus(client, "it", "gone it")
    import_tmx(client, es, MARKED, partner_corpus_id=it)
    wait_for_jobs(client, es)
    with db.session() as conn:
        n = conn.execute("SELECT COUNT(*) FROM segment_markup").fetchone()[0]
        assert n >= 4                                           # two sides of the two marked segments, at least
        conn.execute("DELETE FROM corpora WHERE id IN (?,?)", (es, it))
        assert conn.execute("SELECT COUNT(*) FROM segment_markup").fetchone()[0] < n
