"""Termbase: validation and queries for the (source term, translation) entries of a project."""
import re

from . import nlp

STATUSES = ("candidate", "approved", "forbidden")
POS_VALUES = ("noun", "verb", "adjective", "adverb", "properNoun", "other")   # TBX-Basic partOfSpeech values
ORIGINS = ("manual", "frequency", "keyness", "collocation", "ngram", "concordance", "equivalent")
UPOS_TO_TBX = {"NOUN": "noun", "VERB": "verb", "AUX": "verb", "ADJ": "adjective", "ADV": "adverb",
               "PROPN": "properNoun"}
LIMITS = {"src_term": 200, "tgt_term": 200, "domain": 80, "definition": 2000, "notes": 2000,
          "context": 1000, "context_source": 300}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")    # characters XML 1.0 cannot carry


class TermError(ValueError):
    pass


def _text(value, field: str, *, multiline: bool = False) -> str:
    value = _CONTROL.sub("", str(value or ""))
    value = value.strip() if multiline else " ".join(value.split())
    if len(value) > LIMITS[field]:
        raise TermError(f"{field.replace('_', ' ').capitalize()} is longer than {LIMITS[field]} characters")
    return value


def other_lang(lang: str) -> str:
    """The default target language: the first supported language that is not the source."""
    return next(code for code in nlp.SUPPORTED if code != lang)


def clean(fields: dict, *, partial: bool = False) -> dict:
    """Validate and normalise the fields of an entry (only those present when `partial`)."""
    out: dict = {}
    for name in ("src_term", "tgt_term", "domain", "context_source"):
        if name in fields:
            out[name] = _text(fields[name], name)
    for name in ("definition", "notes", "context"):
        if name in fields:
            out[name] = _text(fields[name], name, multiline=True)
    if "pos" in fields:
        pos = str(fields["pos"] or "").strip()
        pos = UPOS_TO_TBX.get(pos.upper(), pos)
        if pos and pos not in POS_VALUES:
            raise TermError(f"Part of speech must be one of {', '.join(POS_VALUES)}")
        out["pos"] = pos
    if "status" in fields:
        if fields["status"] not in STATUSES:
            raise TermError(f"Status must be one of {', '.join(STATUSES)}")
        out["status"] = fields["status"]
    if "origin" in fields:
        out["origin"] = fields["origin"] if fields["origin"] in ORIGINS else "manual"
    for name in ("src_lang", "tgt_lang"):
        if fields.get(name):          # an empty tgt_lang means "the default" and is filled in below
            if fields[name] not in nlp.SUPPORTED:
                raise TermError(f"{name} must be one of {', '.join(nlp.SUPPORTED)}")
            out[name] = fields[name]
    if not partial:
        if not out.get("src_term"):
            raise TermError("The source term is required")
        out.setdefault("tgt_lang", other_lang(out["src_lang"]))
        if out["tgt_lang"] == out["src_lang"]:
            raise TermError("The target language must differ from the source language")
    return out


def check_consistency(entry: dict) -> None:
    """Rules across fields: an approved or forbidden translation needs a translation."""
    if entry["status"] in ("approved", "forbidden") and not entry["tgt_term"]:
        raise TermError(f"A {entry['status']} entry needs a translation")


def project_where(project: str) -> tuple[str, list]:
    """'' = every project, 'none' = the general termbase, otherwise a project id."""
    if project == "":
        return "1=1", []
    if project == "none":
        return "t.project_id IS NULL", []
    if not project.isdigit():
        raise TermError("project must be empty, 'none' or a project id")
    return "t.project_id=?", [int(project)]


def list_terms(conn, project: str = "", src_lang: str = "", tgt_lang: str = "",
               statuses: tuple[str, ...] = (), q: str = "", limit: int = 5000) -> list[dict]:
    where, params = [project_where(project)[0]], project_where(project)[1]
    if src_lang:
        where.append("t.src_lang=?")
        params.append(src_lang)
    if tgt_lang:
        where.append("t.tgt_lang=?")
        params.append(tgt_lang)
    if statuses:
        where.append(f"t.status IN ({','.join('?' * len(statuses))})")
        params += statuses
    if q.strip():
        like = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(lower(t.src_term) LIKE ? ESCAPE '\\' OR lower(t.tgt_term) LIKE ? ESCAPE '\\')")
        params += [like, like]
    rows = conn.execute(
        f"""SELECT t.*, p.name AS project FROM terms t LEFT JOIN projects p ON p.id=t.project_id
            WHERE {' AND '.join(where)} ORDER BY lower(t.src_term), lower(t.tgt_term), t.id LIMIT ?""",
        [*params, limit]).fetchall()
    return [dict(r) for r in rows]
