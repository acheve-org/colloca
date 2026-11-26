"""TBX export checked against the official TBX schema files kept in tests/schemas/.

What is checked, and what is not:
  * `tbx` (TBX 2019, ISO 30042:2019): validated with lxml against the official TBX core structure RELAX NG schema
    (TBXcoreStructV03.rng, github.com/LTAC-Global/TBX_Core_RNG). That schema only fixes the structure; the TBX-Basic
    value lists and placements live in the dialect's Schematron, which lxml cannot run (XSLT 2). `basic_rule_errors`
    below re-implements those rules by hand from TBX-Basic_DCA.sch (github.com/LTAC-Global/TBX-Basic_dialect).
  * `tbx2` (TBX 2008): no official schema is kept here. Only the data-category value lists are checked.
The tests skip cleanly when the schema file is absent.
"""
from pathlib import Path

import pytest

from corpora import termexport

from .test_termbase import ROWS

lxml_etree = pytest.importorskip("lxml.etree")

SCHEMAS = Path(__file__).parent / "schemas"
NS = "urn:iso:std:iso:30042:ed-2"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

ADMIN_STATUS = {"admittedTerm-admn-sts", "deprecatedTerm-admn-sts", "supersededTerm-admn-sts", "preferredTerm-admn-sts"}
PART_OF_SPEECH = {"adjective", "noun", "other", "verb", "adverb"}
GENDER = {"masculine", "feminine", "neuter", "other"}      # TBX-Basic.rng: grammaticalGender
DESCRIP_TYPES = {"subjectField", "context", "definition"}
TERMNOTE_TYPES = {"administrativeStatus", "partOfSpeech", "geographicalUsage", "grammaticalGender", "termLocation",
                  "termType"}

# every supported part of speech, so a proper noun cannot slip through unchecked
MORE_ROWS = ROWS + [
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term=name, tgt_term=name, pos=pos,
         status="approved", domain="", definition="", notes="", context="", context_source="")
    for name, pos in [("Madrid", "properNoun"), ("firmar", "verb"), ("válido", "adjective"),
                      ("hoy", "adverb"), ("etc", "other")]
] + [
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="plazo", tgt_term=tgt, pos="noun",
         status=status, domain="", definition="", notes="", context="", context_source="")
    for tgt, status in [("termine", "admitted"), ("scadenza", "superseded"), ("durata", "candidate")]
] + [
    # one concept with a synonym on each side, genders, numbers and term-level notes (T19)
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="vivienda", tgt_term="abitazione",
         pos="noun", status="approved", domain="housing", definition="Lugar donde se vive.", notes="", context="",
         context_source="", concept_id=900, src_gender="feminine", src_number="singular", tgt_gender="feminine",
         tgt_number="singular", src_note="Uso general.", tgt_note="Più formale di casa."),
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="vivienda", tgt_term="casa",
         pos="noun", status="admitted", domain="", definition="", notes="", context="", context_source="",
         concept_id=900, src_gender="feminine", src_number="singular", tgt_gender="feminine", tgt_number="singular",
         src_note="", tgt_note=""),
    dict(project_id=1, project="Acme", src_lang="es", tgt_lang="it", src_term="domicilio", tgt_term="abitazione",
         pos="noun", status="approved", domain="", definition="", notes="", context="", context_source="",
         concept_id=900, src_gender="masculine", src_number="singular", tgt_gender="feminine", tgt_number="plural",
         src_note="", tgt_note=""),
]


def basic_rule_errors(root, tags):
    """The TBX-Basic (DCA) data-category rules, from TBX-Basic_DCA.sch. `tags` maps role -> element name."""
    errors = []
    for node in root.iter():
        kind = node.tag.rsplit("}", 1)[-1]
        typ = node.get("type")
        parent = node.getparent().tag.rsplit("}", 1)[-1] if node.getparent() is not None else None
        if kind == "descrip":
            if typ not in DESCRIP_TYPES:
                errors.append(f"descrip type {typ!r}")
            allowed = {"subjectField": {tags["entry"]}, "definition": {tags["entry"], tags["lang"]},
                       "context": {tags["term"]}}.get(typ, set())
            if parent not in allowed:
                errors.append(f"descrip {typ} under {parent}")
        elif kind == "termNote":
            if typ not in TERMNOTE_TYPES:
                errors.append(f"termNote type {typ!r}")
            if parent != tags["term"]:
                errors.append(f"termNote {typ} under {parent}")
            if typ == "administrativeStatus" and node.text not in ADMIN_STATUS:
                errors.append(f"administrativeStatus {node.text!r}")
            if typ == "partOfSpeech" and node.text not in PART_OF_SPEECH:
                errors.append(f"partOfSpeech {node.text!r}")
            if typ == "grammaticalGender" and node.text not in GENDER:
                errors.append(f"grammaticalGender {node.text!r}")
    return errors


def test_tbx3_valid_against_core_rng():
    schema_file = SCHEMAS / "TBXcoreStructV03.rng"
    if not schema_file.exists():
        pytest.skip(f"{schema_file.name} not present")
    schema = lxml_etree.RelaxNG(lxml_etree.parse(str(schema_file)))
    doc = lxml_etree.fromstring(termexport.to_tbx(MORE_ROWS, 3))
    assert schema.validate(doc), str(schema.error_log)
    # known limit: the schema wants at least one conceptEntry, so an export with no rows is not valid TBX
    assert not schema.validate(lxml_etree.fromstring(termexport.to_tbx([], 3)))


def test_tbx3_follows_tbx_basic_rules():
    root = lxml_etree.fromstring(termexport.to_tbx(MORE_ROWS, 3))
    assert (root.get("type"), root.get("style")) == ("TBX-Basic", "dca")
    assert basic_rule_errors(root, dict(entry="conceptEntry", lang="langSec", term="termSec")) == []
    assert all(n.tag.startswith("{" + NS + "}") for n in root.iter())


def test_tbx2_follows_tbx_basic_value_lists():
    root = lxml_etree.fromstring(termexport.to_tbx(MORE_ROWS, 2))
    assert basic_rule_errors(root, dict(entry="termEntry", lang="langSet", term="tig")) == []


def test_committed_samples_are_current():
    samples = Path(__file__).parent.parent / "docs" / "samples"
    for name, version in (("termbase-sample.tbx", 3), ("termbase-sample-tbx2.tbx", 2)):
        expected = termexport.to_tbx(MORE_ROWS, version, title="Corpora sample termbase")
        assert (samples / name).read_bytes() == expected, f"regenerate docs/samples/{name}"
