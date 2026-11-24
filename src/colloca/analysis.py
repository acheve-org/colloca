"""Corpus analyses: frequency, concordance, collocations, n-grams, keyness."""
import math
import random
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass

from . import metadata

UNITS = {"lemma": "lemma", "form": "norm"}  # public name -> column (whitelist)


def _unit(unit: str) -> str:
    if unit not in UNITS:
        raise ValueError("unit must be 'lemma' or 'form'")
    return UNITS[unit]


@dataclass(frozen=True)
class Scope:
    """A corpus, optionally narrowed to the documents matching the metadata filters.

    Every analysis takes a Scope (or a plain corpus id) and computes sizes and counts over the selected
    documents only, so per-million figures and association scores describe the subset, not the whole corpus.
    Dates: a partial date (2024, 2024-05) counts as its first day.
    """
    corpus_id: int
    tags: tuple[str, ...] = ()      # documents carrying ALL of these tags
    text_type: str = ""
    date_from: str = ""
    date_to: str = ""
    doc_ids: tuple[int, ...] = ()
    paired_only: bool = False       # only documents aligned with a translation (parallel texts)

    @property
    def filtered(self) -> bool:
        return bool(self.tags or self.text_type or self.date_from or self.date_to or self.doc_ids
                    or self.paired_only)

    def where(self, alias: str = "d") -> tuple[str, list]:
        """SQL condition (on documents aliased `alias`) and its parameters."""
        conds, params = [f"{alias}.corpus_id=?"], [self.corpus_id]
        for tag in self.tags:
            conds.append(f"EXISTS (SELECT 1 FROM doc_tags g WHERE g.doc_id={alias}.id AND g.tag=?)")
            params.append(tag)
        if self.text_type:
            conds.append(f"{alias}.text_type=?")
            params.append(self.text_type)
        if self.date_from or self.date_to:
            start = (f"CASE length({alias}.doc_date) WHEN 4 THEN {alias}.doc_date||'-01-01' "
                     f"WHEN 7 THEN {alias}.doc_date||'-01' ELSE {alias}.doc_date END")
            conds.append(f"{alias}.doc_date<>''")      # undated documents never match a date filter
            if self.date_from:
                conds.append(f"{start} >= ?")
                params.append(metadata.pad_start(self.date_from))
            if self.date_to:
                conds.append(f"{start} <= ?")
                params.append(metadata.pad_end(self.date_to))
        if self.doc_ids:
            conds.append(f"{alias}.id IN ({','.join('?' * len(self.doc_ids))})")
            params += self.doc_ids
        if self.paired_only:
            conds.append(f"{alias}.segmented=1 AND {alias}.pair_doc_id IS NOT NULL")
        return " AND ".join(conds), params


def as_scope(corpus: int | Scope) -> Scope:
    return corpus if isinstance(corpus, Scope) else Scope(corpus)


def corpus_size(conn: sqlite3.Connection, scope) -> int:
    """Number of alphabetic tokens (the denominator for all relative measures)."""
    w, params = as_scope(scope).where()
    row = conn.execute(f"SELECT COALESCE(SUM(d.n_tokens),0) FROM documents d WHERE {w}", params).fetchone()
    return int(row[0])


def n_docs(conn, scope) -> int:
    w, params = as_scope(scope).where()
    return conn.execute(f"SELECT COUNT(*) FROM documents d WHERE {w}", params).fetchone()[0]


# --------------------------------------------------------------------------- reference (base) corpora
def reference_corpus(conn, lang: str):
    """The base corpus of `lang` (a corpora row) or None."""
    return conn.execute("SELECT * FROM corpora WHERE lang=? AND is_reference=1", (lang,)).fetchone()


def counts_for(conn, scope, unit: str, items) -> dict[str, int]:
    """Frequency of each of `items` (lemmas or forms) in the selected documents; absent items map to 0."""
    col = _unit(unit)
    w, scope_params = as_scope(scope).where()
    items = list(dict.fromkeys(items))
    out = dict.fromkeys(items, 0)
    for i in range(0, len(items), 500):                 # stay well below SQLite's parameter limit
        chunk = items[i:i + 500]
        rows = conn.execute(
            f"""SELECT t.{col} AS item, COUNT(*) AS c FROM tokens t JOIN documents d ON d.id=t.doc_id
                WHERE {w} AND t.alpha=1 AND t.{col} IN ({",".join("?" * len(chunk))})
                GROUP BY t.{col}""", [*scope_params, *chunk]).fetchall()
        out.update({r["item"]: r["c"] for r in rows})
    return out


def reference_counts(conn, ref_id: int, unit: str, items) -> dict[str, int]:
    """Frequency of each of `items` in the reference corpus; absent items map to 0."""
    return counts_for(conn, Scope(ref_id), unit, items)


def add_reference_columns(conn, rows: list[dict], ref_id: int, unit: str) -> None:
    """Annotate frequency/collocation rows in place with the item's frequency in the reference corpus."""
    size = max(corpus_size(conn, ref_id), 1)
    counts = reference_counts(conn, ref_id, unit, (r["item"] for r in rows))
    for r in rows:
        r["ref_freq"] = counts[r["item"]]
        r["ref_per_million"] = round(counts[r["item"]] * 1_000_000 / size, 1)


# --------------------------------------------------------------------------- frequency
def frequency(conn, scope, unit="lemma", pos=None, min_freq=1, exclude_stop=True,
              alpha_only=True, limit=500):
    scope = as_scope(scope)
    col = _unit(unit)
    w0, params = scope.where()
    where, params = [w0], list(params)
    if alpha_only:
        where.append("t.alpha=1")
    if exclude_stop:
        where.append("t.stop=0")
    if pos:
        where.append(f"t.upos IN ({','.join('?' * len(pos))})")
        params += pos
    w = " AND ".join(where)
    rows = conn.execute(
        f"""SELECT t.{col} AS item, COUNT(*) AS freq, COUNT(DISTINCT t.doc_id) AS docs
            FROM tokens t JOIN documents d ON d.id=t.doc_id WHERE {w}
            GROUP BY t.{col} HAVING COUNT(*) >= ? ORDER BY freq DESC, item LIMIT ?""",
        params + [min_freq, limit]).fetchall()
    pos_rows = conn.execute(
        f"""SELECT t.{col} AS item, t.upos AS upos, COUNT(*) AS c
            FROM tokens t JOIN documents d ON d.id=t.doc_id WHERE {w}
            GROUP BY t.{col}, t.upos""", params).fetchall()
    best: dict[str, tuple[int, str]] = {}
    for r in pos_rows:
        if r["item"] not in best or r["c"] > best[r["item"]][0]:
            best[r["item"]] = (r["c"], r["upos"])
    size = max(corpus_size(conn, scope), 1)
    total_docs = max(n_docs(conn, scope), 1)
    return [{"item": r["item"], "pos": best.get(r["item"], (0, ""))[1], "freq": r["freq"],
             "per_million": round(r["freq"] * 1_000_000 / size, 1),
             "docs": r["docs"], "docs_pct": round(100 * r["docs"] / total_docs, 1)} for r in rows]


def lemma_counts(conn, scope) -> dict[str, int]:
    w, params = as_scope(scope).where()
    rows = conn.execute(
        f"""SELECT t.lemma, COUNT(*) FROM tokens t JOIN documents d ON d.id=t.doc_id
            WHERE {w} AND t.alpha=1 GROUP BY t.lemma""", params).fetchall()
    return {r[0]: r[1] for r in rows}


# --------------------------------------------------------------------------- concordance
SORTS = ("doc", "left", "right", "l1", "l2", "r1", "r2")   # whole left/right context, or the 1st/2nd word to one side
MIN_WILDCARD_LITERALS = 3
MAX_ANY_ORDER_ROWS = 50_000


def _parse_query(q: str, case_sensitive: bool = False, wild: bool = False) -> list[str]:
    """The words of a query. `*` (only with `wild`) may start and/or end a word: `contrat*`, `*miento`."""
    terms = (q if case_sensitive else q.lower()).split()
    if not terms or len(terms) > 6:
        raise ValueError("Query must have 1-6 words")
    if wild:
        for term in terms:
            if "*" not in term:
                continue
            if "*" in term.strip("*"):
                raise ValueError("The wildcard * can only start or end a word, as in contrat* or *miento")
            if len(term.strip("*")) < MIN_WILDCARD_LITERALS:
                raise ValueError(f"A word with a wildcard needs at least {MIN_WILDCARD_LITERALS} letters besides *")
    return terms


def _glob(term: str) -> str:
    """Escape GLOB's own special characters (? [) in the literal part of a word; `*` stays a wildcard."""
    return term.replace("[", "[[]").replace("?", "[?]")


def _term_cond(alias: str, col: str, term: str, case_sensitive: bool, wild: bool) -> tuple[str, list]:
    """SQL condition and parameters matching one word on `alias`.`col`. Case-sensitive matching compares the
    written `form`; the lower-cased column is still tested first so its index narrows the search."""
    if case_sensitive:
        lowered = term.lower()
        if wild and "*" in term:
            return (f"{alias}.norm GLOB ? AND {alias}.form GLOB ?", [_glob(lowered), _glob(term)])
        return (f"{alias}.norm=? AND {alias}.form=?", [lowered, term])
    if wild and "*" in term:
        return f"{alias}.{col} GLOB ?", [_glob(term)]       # GLOB is case-sensitive: uses the index for a prefix
    return f"{alias}.{col}=?", [term]


def _find_hits(conn, scope, terms, col, case_sensitive=False, any_order=False, wild=False):
    """Hits of the word sequence `terms` (matching on lemma or form): dicts with doc_id, pos (first token),
    sent, span (tokens from the first to the last matched word) and ps (positions of the matched words).
    With `any_order` the words may come in any
    order inside one sentence, and `span` covers everything between the first and last of them."""
    w, scope_params = as_scope(scope).where()
    joins, conds, params = [], [], list(scope_params)
    for i, term in enumerate(terms):
        if i:
            if any_order:
                joins.append(f"JOIN tokens t{i} ON t{i}.doc_id=t0.doc_id AND t{i}.sent=t0.sent "
                             f"AND t{i}.pos BETWEEN t0.pos-60 AND t0.pos+60 "
                             + "".join(f"AND t{i}.pos<>t{j}.pos " for j in range(i)))
            else:
                joins.append(f"JOIN tokens t{i} ON t{i}.doc_id=t0.doc_id AND t{i}.pos=t0.pos+{i}")
        cond, p = _term_cond(f"t{i}", col, term, case_sensitive, wild)
        conds.append(cond)
        params += p
    select = "t0.doc_id, t0.sent, " + ", ".join(f"t{i}.pos AS p{i}" for i in range(len(terms)))
    sql = (f"SELECT {select} FROM tokens t0 {' '.join(joins)} JOIN documents d ON d.id=t0.doc_id "
           f"WHERE {w} AND {' AND '.join(conds)} ORDER BY t0.doc_id, t0.pos")
    if any_order:
        sql += f" LIMIT {MAX_ANY_ORDER_ROWS}"
    out, seen = [], set()
    for r in conn.execute(sql, params):
        ps = [r[f"p{i}"] for i in range(len(terms))]
        if any_order:
            key = (r["doc_id"], frozenset(ps))
            if key in seen:
                continue
            seen.add(key)
        first, last = min(ps), max(ps)
        out.append({"doc_id": r["doc_id"], "pos": first, "sent": r["sent"], "span": last - first + 1,
                    "ps": sorted(ps)})
    if any_order:
        out.sort(key=lambda h: (h["doc_id"], h["pos"]))
    return out


def _join(rows) -> str:
    return "".join(r["form"] + (" " if r["sp"] else "") for r in rows).strip()


def _sort_key(sort: str):
    """Key over a line's reversed left words `_l` and right words `_r` (all lower-cased)."""
    if sort in ("left", "right"):
        side = "_l" if sort == "left" else "_r"
        return lambda x: x[side]
    side, k = ("_l" if sort[0] == "l" else "_r"), int(sort[1]) - 1
    return lambda x: (x[side][k:k + 1], x[side])


def concordance(conn, scope, q, unit="lemma", width=8, limit=300, sort="doc",
                case_sensitive=False, any_order=False, sample=None):
    """KWIC lines. `case_sensitive` matches the written form exactly, `*` is a wildcard at the start or end of
    a word, `any_order` finds the words anywhere in one sentence, and `sample` (a seed) returns a reproducible
    random selection of `limit` hits instead of the first ones. `total` is always the number of hits found."""
    scope = as_scope(scope)
    if sort not in SORTS:
        raise ValueError(f"sort must be one of {', '.join(SORTS)}")
    col = _unit(unit)
    terms = _parse_query(q, case_sensitive, wild=True)
    hits = _find_hits(conn, scope, terms, col, case_sensitive, any_order, wild=True)
    total = len(hits)
    if sample is not None and total > limit:
        keep = sorted(random.Random(sample).sample(range(total), limit))   # context is fetched for these only
        hits = [hits[i] for i in keep]
    titles = {r["id"]: r["title"] for r in
              conn.execute("SELECT id,title FROM documents WHERE corpus_id=?", (scope.corpus_id,))}
    lines = []
    for h in hits[:limit * 5 if sort != "doc" else limit]:
        n = h["span"]
        ctx = conn.execute(
            "SELECT pos, form, sp FROM tokens WHERE doc_id=? AND pos BETWEEN ? AND ? ORDER BY pos",
            (h["doc_id"], h["pos"] - width, h["pos"] + n - 1 + width)).fetchall()
        left = [r for r in ctx if r["pos"] < h["pos"]]
        node = [r for r in ctx if h["pos"] <= r["pos"] < h["pos"] + n]
        right = [r for r in ctx if r["pos"] >= h["pos"] + n]
        lines.append({"doc_id": h["doc_id"], "doc": titles.get(h["doc_id"], ""), "pos": h["pos"],
                      "matches": h["ps"], "left": _join(left), "node": _join(node), "right": _join(right),
                      "_l": [r["form"].lower() for r in reversed(left)],
                      "_r": [r["form"].lower() for r in right]})
    if sort != "doc":
        lines.sort(key=_sort_key(sort))
    lines = lines[:limit]
    for ln in lines:
        ln.pop("_l"), ln.pop("_r")
    return {"total": total, "lines": lines}


def examples(conn, scope, q, unit="lemma", limit=5):
    """Whole sentences containing `q`: the ones closest to a comfortable length come first."""
    scope = as_scope(scope)
    terms = _parse_query(q)
    hits = _find_hits(conn, scope, terms, _unit(unit))
    titles = {r["id"]: r["title"] for r in
              conn.execute("SELECT id,title FROM documents WHERE corpus_id=?", (scope.corpus_id,))}
    step = max(1, len(hits) // 300)               # look at an even spread of at most ~300 hits
    seen, out = set(), []
    for h in hits[::step]:
        rows = conn.execute("SELECT form, sp FROM tokens WHERE doc_id=? AND sent=? ORDER BY pos",
                            (h["doc_id"], h["sent"])).fetchall()
        sentence = _join(rows)
        key = sentence.lower()
        if len(rows) < 4 or key in seen:
            continue
        seen.add(key)
        out.append((abs(len(rows) - 18), {"sentence": sentence, "doc": titles.get(h["doc_id"], ""),
                                          "doc_id": h["doc_id"]}))
    out.sort(key=lambda x: x[0])
    return [item for _, item in out[:limit]]


# --------------------------------------------------------------------------- collocations
def logdice(o: float, f_node: float, f_coll: float) -> float:
    """logDice (Rychlý 2008): 14 + log2(2·o / (f_node + f_coll)); max 14, independent of corpus size."""
    return 14 + math.log2(2 * o / (f_node + f_coll))


def expected_cooc(f_node: float, f_coll: float, span: int, n: float) -> float:
    """Co-occurrences expected by chance for a window of `span` positions around each node."""
    return f_node * f_coll * span / n


def mutual_information(o: float, expected: float) -> float:
    """Pointwise MI: log2(observed / expected)."""
    return math.log2(o / expected) if expected > 0 and o > 0 else 0.0


def t_score(o: float, expected: float) -> float:
    return (o - expected) / math.sqrt(o)


def _g2(a, b, c, d) -> float:
    n = a + b + c + d
    ll = 0.0
    for o, r, cc in ((a, a + b, a + c), (b, a + b, b + d), (c, c + d, a + c), (d, c + d, b + d)):
        e = r * cc / n if n else 0
        if o > 0 and e > 0:
            ll += o * math.log(o / e)
    return 2 * ll


def collocations(conn, scope, q, left=4, right=4, min_freq=2, exclude_stop=True,
                 pos=None, limit=200):
    """Window collocations of a single lemma, never crossing sentence boundaries."""
    scope = as_scope(scope)
    terms = _parse_query(q)
    if len(terms) != 1:
        raise ValueError("Collocations need a single node word")
    node = terms[0]
    hits = _find_hits(conn, scope, terms, "lemma")
    if not hits:
        return {"node_freq": 0, "corpus_size": corpus_size(conn, scope), "rows": []}
    counts = lemma_counts(conn, scope)
    N = max(corpus_size(conn, scope), 1)
    f_n = len(hits)
    span = left + right
    co: Counter = Counter()
    docs: dict[str, set] = defaultdict(set)
    pos_of: dict[str, Counter] = defaultdict(Counter)
    for h in hits:
        rows = conn.execute(
            """SELECT pos, lemma, upos, alpha, stop FROM tokens
               WHERE doc_id=? AND sent=? AND pos BETWEEN ? AND ? AND pos<>?""",
            (h["doc_id"], h["sent"], h["pos"] - left, h["pos"] + right, h["pos"])).fetchall()
        for r in rows:
            if not r["alpha"] or (exclude_stop and r["stop"]) or r["lemma"] == node:
                continue
            if pos and r["upos"] not in pos:
                continue
            co[r["lemma"]] += 1
            docs[r["lemma"]].add(h["doc_id"])
            pos_of[r["lemma"]][r["upos"]] += 1
    out = []
    for lemma, o in co.items():
        if o < min_freq:
            continue
        f_c = counts.get(lemma, o)
        expected = expected_cooc(f_n, f_c, span, N)
        a, b = o, f_n * span - o
        c, d = f_c - o, N - f_n * span - f_c + o
        out.append({
            "item": lemma, "pos": pos_of[lemma].most_common(1)[0][0],
            "cooc": o, "freq": f_c, "docs": len(docs[lemma]),
            "logdice": round(logdice(o, f_n, f_c), 2),
            "mi": round(mutual_information(o, expected), 2),
            "tscore": round(t_score(o, expected), 2),
            "ll": round(_g2(a, max(b, 0), max(c, 0), max(d, 0)), 1),
        })
    out.sort(key=lambda r: (-r["logdice"], -r["cooc"]))
    return {"node_freq": f_n, "corpus_size": N, "rows": out[:limit]}


# --------------------------------------------------------------------------- n-grams
def ngrams(conn, scope, n=3, unit="form", min_freq=2, min_docs=1, edge_stop=False,
           limit=300):
    """Contiguous alphabetic n-grams inside a sentence."""
    col = _unit(unit)
    w, params = as_scope(scope).where()
    if not 2 <= n <= 6:
        raise ValueError("n must be between 2 and 6")
    freq: Counter = Counter()
    docs: dict[tuple, set] = defaultdict(set)
    cur = conn.execute(
        f"""SELECT t.doc_id, t.sent, t.{col} AS w, t.alpha, t.stop FROM tokens t
            JOIN documents d ON d.id=t.doc_id WHERE {w} ORDER BY t.doc_id, t.pos""",
        params)
    key, buf = None, []

    def flush(doc_id):
        for i in range(len(buf) - n + 1):
            win = buf[i:i + n]
            if not all(t[1] for t in win):
                continue
            if not edge_stop and (win[0][2] or win[-1][2]):
                continue
            g = tuple(t[0] for t in win)
            freq[g] += 1
            docs[g].add(doc_id)

    for r in cur:
        k = (r["doc_id"], r["sent"])
        if k != key:
            if key:
                flush(key[0])
            key, buf = k, []
        buf.append((r["w"], r["alpha"], r["stop"]))
    if key:
        flush(key[0])
    rows = [{"item": " ".join(g), "freq": c, "docs": len(docs[g])}
            for g, c in freq.items() if c >= min_freq and len(docs[g]) >= min_docs]
    rows.sort(key=lambda r: (-r["freq"], r["item"]))
    return rows[:limit]


# --------------------------------------------------------------------------- keyness
def keyness_ll(a: float, b: float, c1: float, c2: float) -> float:
    """Dunning log-likelihood (G2) of a word seen `a` times in a corpus of c1 words and `b` times in c2."""
    e1, e2 = c1 * (a + b) / (c1 + c2), c2 * (a + b) / (c1 + c2)
    return 2 * ((a * math.log(a / e1) if a else 0) + (b * math.log(b / e2) if b else 0))


def keyness(conn, scope, ref_id, unit="lemma", min_freq=3, exclude_stop=True,
            pos=None, limit=300, both_directions=False):
    """Log-likelihood keyness of this corpus against a reference corpus.

    With `both_directions`, words that occur only in the reference (a = 0, at least `min_freq` times there)
    are scored too, with a negative LL; every row then carries `direction` ("over" / "under") and rows are
    ordered by |LL|, so the strongest over- and under-used words come first."""
    scope = as_scope(scope)
    t = frequency(conn, scope, unit, pos, 1, exclude_stop, True, 10**9)
    r = frequency(conn, ref_id, unit, pos, 1, exclude_stop, True, 10**9)
    ref = {x["item"]: x["freq"] for x in r}
    c1, c2 = max(corpus_size(conn, scope), 1), max(corpus_size(conn, ref_id), 1)
    out = []
    for x in t:
        a, b = x["freq"], ref.get(x["item"], 0)
        if a < min_freq:
            continue
        ll = keyness_ll(a, b, c1, c2)
        over = a / c1 > b / c2
        out.append({
            "item": x["item"], "pos": x["pos"], "freq": a, "ref_freq": b,
            "per_million": x["per_million"], "ref_per_million": round(b * 1e6 / c2, 1),
            "log_ratio": round(math.log2((a / c1) / ((b or 0.5) / c2)), 2),
            "ll": round(ll if over else -ll, 1), "docs": x["docs"],
        })
        if both_directions:
            out[-1]["direction"] = "over" if over else "under"
    if both_directions:
        seen = {x["item"] for x in t}
        for x in r:
            b = x["freq"]
            if x["item"] in seen or b < min_freq:
                continue
            out.append({
                "item": x["item"], "pos": x["pos"], "freq": 0, "ref_freq": b,
                "per_million": 0.0, "ref_per_million": round(b * 1e6 / c2, 1),
                "log_ratio": round(math.log2((0.5 / c1) / (b / c2)), 2),
                "ll": round(-keyness_ll(0, b, c1, c2), 1), "docs": 0, "direction": "under",
            })
        out.sort(key=lambda r: -abs(r["ll"]))
    else:
        out.sort(key=lambda r: -r["ll"])
    return out[:limit]
