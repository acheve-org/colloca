"""Termbase: validation and queries for the (source term, translation) entries of a project."""
import re

from . import nlp, trash

# approved = the preferred term, admitted = an acceptable alternative, superseded = obsolete, forbidden = do not use
STATUSES = ("candidate", "approved", "admitted", "superseded", "forbidden")
NEEDS_TRANSLATION = ("approved", "admitted", "superseded", "forbidden")
POS_VALUES = ("noun", "verb", "adjective", "adverb", "properNoun", "other")   # TBX-Basic partOfSpeech values
ORIGINS = ("manual", "frequency", "keyness", "collocation", "ngram", "concordance", "equivalent", "job")
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
    """Rules across fields: every status but candidate needs a translation."""
    if entry["status"] in NEEDS_TRANSLATION and not entry["tgt_term"]:
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


# Sortable columns (whitelisted: they are interpolated into the SQL). Text sorts case-insensitively.
SORT_COLUMNS = {"src_term": "lower(t.src_term)", "tgt_term": "lower(t.tgt_term)", "pos": "t.pos",
                "status": "t.status", "domain": "lower(t.domain)", "updated": "t.updated", "created": "t.created",
                "context": "lower(t.context)"}


def list_terms(conn, project: str = "", src_lang: str = "", tgt_lang: str = "",
               statuses: tuple[str, ...] = (), q: str = "", limit: int = 5000, *, sort: str = "", desc: bool = False,
               domain: str = "", pos: str = "", modified_since: str = "") -> list[dict]:
    """Entries of a project, filtered and sorted in SQL so a large termbase is cut after sorting, not before.
    `domain` matches exactly (case-insensitive), `pos` exactly, `modified_since` is an ISO date (YYYY-MM-DD)."""
    where, params = [project_where(project)[0], "t.deleted_at IS NULL"], project_where(project)[1]
    if src_lang:
        where.append("t.src_lang=?")
        params.append(src_lang)
    if tgt_lang:
        where.append("t.tgt_lang=?")
        params.append(tgt_lang)
    if statuses:
        where.append(f"t.status IN ({','.join('?' * len(statuses))})")
        params += statuses
    if domain:
        where.append("lower(t.domain)=?")
        params.append(domain.strip().lower())
    if pos:
        where.append("t.pos=?")
        params.append(pos)
    if modified_since:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", modified_since):
            raise TermError("modified_since must be a date like 2026-01-31")
        where.append("t.updated >= ?")
        params.append(modified_since)
    if q.strip():
        like = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(lower(t.src_term) LIKE ? ESCAPE '\\' OR lower(t.tgt_term) LIKE ? ESCAPE '\\')")
        params += [like, like]
    if sort and sort not in SORT_COLUMNS:
        raise TermError(f"sort must be one of {', '.join(SORT_COLUMNS)}")
    order = ""
    if sort:
        order = f"{SORT_COLUMNS[sort]} {'DESC' if desc else 'ASC'}, "
    rows = conn.execute(
        f"""SELECT t.*, p.name AS project FROM terms t LEFT JOIN projects p ON p.id=t.project_id
            WHERE {' AND '.join(where)} ORDER BY {order}lower(t.src_term), lower(t.tgt_term), t.id LIMIT ?""",
        [*params, limit]).fetchall()
    return [dict(r) for r in rows]


def bulk_update(conn, ids: list[int], *, status: str | None = None, domain: str | None = None) -> int:
    """Set the status and/or domain of several entries at once; all or nothing.
    Setting a status that needs a translation fails if any selected entry has none."""
    if not ids:
        raise TermError("No entries selected")
    changes = clean({k: v for k, v in (("status", status), ("domain", domain)) if v is not None}, partial=True)
    if not changes:
        raise TermError("Nothing to change")
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT id, tgt_term FROM terms WHERE id IN ({marks})", ids).fetchall()
    if changes.get("status") in NEEDS_TRANSLATION:
        missing = [r["id"] for r in rows if not r["tgt_term"]]
        if missing:
            raise TermError(f"{len(missing)} selected entries have no translation, so they cannot be "
                            f"{changes['status']}")
    cols = ", ".join(f"{c}=?" for c in changes)
    conn.execute(f"UPDATE terms SET {cols}, updated=CURRENT_TIMESTAMP WHERE id IN ({marks})",
                 [*changes.values(), *ids])
    return len(rows)


def bulk_delete(conn, ids: list[int]) -> int:
    """Move entries to the Trash (see trash.py)."""
    if not ids:
        raise TermError("No entries selected")
    return trash.trash_terms(conn, ids)


def drop_trashed_twin(conn, project_id: int | None, src_lang: str, tgt_lang: str, src_term: str, tgt_term: str,
                      keep_id: int | None = None) -> None:
    """A trashed entry still occupies its place in the unique index; a live entry with the same key replaces it."""
    conn.execute("""DELETE FROM terms WHERE deleted_at IS NOT NULL AND IFNULL(project_id,0)=? AND src_lang=?
                    AND tgt_lang=? AND lower(src_term)=lower(?) AND lower(tgt_term)=lower(?) AND id IS NOT ?""",
                 (project_id or 0, src_lang, tgt_lang, src_term, tgt_term, keep_id))
