"""Candidate review: the stop list (dropped terms) and the "already in the termbase" lookup.

A candidate is a word or phrase shown in an analysis table (keyness, frequency, n-grams, collocations, the
job report). Two facts are attached to it, per project and language:
  * `in_termbase`: the status of the termbase entry that has it ("" when there is none). Single words match
    by lemma (and by form), phrases by their lowercase word forms. Every status counts, `candidate` too;
  * `dropped`: it is on the project's stop list (`term_rejections`).
"""
import threading

from . import nlp

_lock = threading.Lock()
_cache: dict[tuple, dict] = {}
_CACHE_MAX = 32
# the entry shown when several have the same source term: the most "settled" status first
_RANK = ("approved", "admitted", "forbidden", "superseded", "candidate")


def _scope(corpus) -> tuple[int | None, str]:
    return corpus["project_id"], corpus["lang"]


def norm(term: str) -> str:
    return " ".join(term.lower().split())


def _version(conn, project_id, lang) -> tuple:
    """Changes whenever an entry of the project and language is added, removed or edited, so the lemmatised
    index is rebuilt only then (`updated` has second resolution, so the text lengths are added)."""
    where, params = ("project_id IS NULL", []) if project_id is None else ("project_id=?", [project_id])
    return tuple(conn.execute(
        f"""SELECT COUNT(*), IFNULL(MAX(id), 0), IFNULL(MAX(updated), ''),
                   IFNULL(SUM(length(src_term) + length(status)), 0)
            FROM terms WHERE {where} AND src_lang=?""", [*params, lang]).fetchone())


def _build(conn, project_id, lang) -> dict[str, str]:
    where, params = ("project_id IS NULL", []) if project_id is None else ("project_id=?", [project_id])
    rows = [dict(r) for r in conn.execute(
        f"SELECT src_term, status FROM terms WHERE {where} AND src_lang=? ORDER BY id", [*params, lang])]
    rows = [r for r in rows if r["src_term"].split()]
    if not rows:
        return {}
    spans: list[tuple[int, int]] = []
    toks = list(nlp.annotate("\n".join(" ".join(r["src_term"].split()) for r in rows), lang, None, spans))
    index: dict[str, str] = {}

    def put(key: str, status: str) -> None:
        old = index.get(key)
        if old is None or _RANK.index(status) < _RANK.index(old):
            index[key] = status

    for r, (a, b) in zip(rows, spans, strict=True):
        part = toks[a:b]
        put(" ".join(t[3] for t in part), r["status"])                   # by form (phrases and words)
        if len(part) == 1:
            put(part[0][4].lower(), r["status"])                          # a single word also by lemma
    return index


def termbase_index(conn, corpus) -> dict[str, str]:
    """Lowercase form or lemma -> best status, cached per (project, language, termbase version)."""
    project_id, lang = _scope(corpus)
    key = (project_id, lang, _version(conn, project_id, lang))
    with _lock:
        hit = _cache.get(key)
    if hit is not None:
        return hit
    index = _build(conn, project_id, lang)
    with _lock:
        for k in [k for k in _cache if k[:2] == key[:2]]:        # older versions of this termbase
            del _cache[k]
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
        _cache[key] = index
    return index


def rejected(conn, corpus) -> set[str]:
    project_id, lang = _scope(corpus)
    where, params = ("project_id IS NULL", []) if project_id is None else ("project_id=?", [project_id])
    return {r[0] for r in conn.execute(
        f"SELECT term FROM term_rejections WHERE {where} AND lang=?", [*params, lang])}


def annotate(conn, corpus, rows: list[dict], field: str = "item") -> list[dict]:
    """Adds `in_termbase` ('' or the entry's status) and `dropped` to each row, in place."""
    index = termbase_index(conn, corpus)
    stop = rejected(conn, corpus)
    for r in rows:
        key = norm(r[field])
        r["in_termbase"] = index.get(key, "")
        r["dropped"] = key in stop
    return rows


def list_rejections(conn, corpus) -> list[dict]:
    project_id, lang = _scope(corpus)
    where, params = ("project_id IS NULL", []) if project_id is None else ("project_id=?", [project_id])
    return [dict(r) for r in conn.execute(
        f"SELECT term, created FROM term_rejections WHERE {where} AND lang=? ORDER BY term", [*params, lang])]


def reject(conn, corpus, terms: list[str]) -> int:
    project_id, lang = _scope(corpus)
    n = 0
    for term in {norm(t)[:200] for t in terms if norm(t)}:
        cur = conn.execute(
            "INSERT OR IGNORE INTO term_rejections (project_id, lang, term) VALUES (?,?,?)",
            (project_id, lang, term))
        n += cur.rowcount
    return n


def restore(conn, corpus, terms: list[str]) -> int:
    project_id, lang = _scope(corpus)
    n = 0
    for term in {norm(t) for t in terms}:
        cur = conn.execute(
            "DELETE FROM term_rejections WHERE IFNULL(project_id,0)=? AND lang=? AND term=?",
            (project_id or 0, lang, term))
        n += cur.rowcount
    return n
