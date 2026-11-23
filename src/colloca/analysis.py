"""Corpus analyses: frequency, concordance, collocations, n-grams, keyness."""
import math
import sqlite3
from collections import Counter, defaultdict

UNITS = {"lemma": "lemma", "form": "norm"}  # public name -> column (whitelist)


def _unit(unit: str) -> str:
    if unit not in UNITS:
        raise ValueError("unit must be 'lemma' or 'form'")
    return UNITS[unit]


def corpus_size(conn: sqlite3.Connection, corpus_id: int) -> int:
    """Number of alphabetic tokens (the denominator for all relative measures)."""
    row = conn.execute(
        "SELECT COALESCE(SUM(n_tokens),0) FROM documents WHERE corpus_id=?", (corpus_id,)).fetchone()
    return int(row[0])


def n_docs(conn, corpus_id) -> int:
    return conn.execute("SELECT COUNT(*) FROM documents WHERE corpus_id=?", (corpus_id,)).fetchone()[0]


# --------------------------------------------------------------------------- frequency
def frequency(conn, corpus_id, unit="lemma", pos=None, min_freq=1, exclude_stop=True,
              alpha_only=True, limit=500):
    col = _unit(unit)
    where, params = ["d.corpus_id=?"], [corpus_id]
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
    size = max(corpus_size(conn, corpus_id), 1)
    total_docs = max(n_docs(conn, corpus_id), 1)
    return [{"item": r["item"], "pos": best.get(r["item"], (0, ""))[1], "freq": r["freq"],
             "per_million": round(r["freq"] * 1_000_000 / size, 1),
             "docs": r["docs"], "docs_pct": round(100 * r["docs"] / total_docs, 1)} for r in rows]


def lemma_counts(conn, corpus_id) -> dict[str, int]:
    rows = conn.execute(
        """SELECT t.lemma, COUNT(*) FROM tokens t JOIN documents d ON d.id=t.doc_id
           WHERE d.corpus_id=? AND t.alpha=1 GROUP BY t.lemma""", (corpus_id,)).fetchall()
    return {r[0]: r[1] for r in rows}


# --------------------------------------------------------------------------- concordance
def _parse_query(q: str) -> list[str]:
    terms = q.lower().split()
    if not terms or len(terms) > 6:
        raise ValueError("Query must have 1-6 words")
    return terms


def _find_hits(conn, corpus_id, terms, col):
    """Positions where the word sequence `terms` occurs (matching on lemma or form)."""
    joins, conds, params = [], [], [corpus_id]
    for i, term in enumerate(terms):
        if i:
            joins.append(f"JOIN tokens t{i} ON t{i}.doc_id=t0.doc_id AND t{i}.pos=t0.pos+{i}")
        conds.append(f"t{i}.{col}=?")
        params.append(term)
    sql = (f"SELECT t0.doc_id, t0.pos, t0.sent FROM tokens t0 {' '.join(joins)} "
           f"JOIN documents d ON d.id=t0.doc_id WHERE d.corpus_id=? AND {' AND '.join(conds)} "
           "ORDER BY t0.doc_id, t0.pos")
    return conn.execute(sql, params).fetchall()


def _join(rows) -> str:
    return "".join(r["form"] + (" " if r["sp"] else "") for r in rows).strip()


def concordance(conn, corpus_id, q, unit="lemma", width=8, limit=300, sort="doc"):
    col = _unit(unit)
    terms = _parse_query(q)
    hits = _find_hits(conn, corpus_id, terms, col)
    n = len(terms)
    titles = {r["id"]: r["title"] for r in
              conn.execute("SELECT id,title FROM documents WHERE corpus_id=?", (corpus_id,))}
    lines = []
    for h in hits[:limit * 5 if sort != "doc" else limit]:
        ctx = conn.execute(
            "SELECT pos, form, sp FROM tokens WHERE doc_id=? AND pos BETWEEN ? AND ? ORDER BY pos",
            (h["doc_id"], h["pos"] - width, h["pos"] + n - 1 + width)).fetchall()
        left = [r for r in ctx if r["pos"] < h["pos"]]
        node = [r for r in ctx if h["pos"] <= r["pos"] < h["pos"] + n]
        right = [r for r in ctx if r["pos"] >= h["pos"] + n]
        lines.append({"doc_id": h["doc_id"], "doc": titles.get(h["doc_id"], ""), "pos": h["pos"],
                      "left": _join(left), "node": _join(node), "right": _join(right),
                      "_l": [r["form"].lower() for r in reversed(left)],
                      "_r": [r["form"].lower() for r in right]})
    if sort == "left":
        lines.sort(key=lambda x: x["_l"])
    elif sort == "right":
        lines.sort(key=lambda x: x["_r"])
    lines = lines[:limit]
    for ln in lines:
        ln.pop("_l"), ln.pop("_r")
    return {"total": len(hits), "lines": lines}


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


def collocations(conn, corpus_id, q, left=4, right=4, min_freq=2, exclude_stop=True,
                 pos=None, limit=200):
    """Window collocations of a single lemma, never crossing sentence boundaries."""
    terms = _parse_query(q)
    if len(terms) != 1:
        raise ValueError("Collocations need a single node word")
    node = terms[0]
    hits = _find_hits(conn, corpus_id, terms, "lemma")
    if not hits:
        return {"node_freq": 0, "corpus_size": corpus_size(conn, corpus_id), "rows": []}
    counts = lemma_counts(conn, corpus_id)
    N = max(corpus_size(conn, corpus_id), 1)
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
def ngrams(conn, corpus_id, n=3, unit="form", min_freq=2, min_docs=1, edge_stop=False,
           limit=300):
    """Contiguous alphabetic n-grams inside a sentence."""
    col = _unit(unit)
    if not 2 <= n <= 6:
        raise ValueError("n must be between 2 and 6")
    freq: Counter = Counter()
    docs: dict[tuple, set] = defaultdict(set)
    cur = conn.execute(
        f"""SELECT t.doc_id, t.sent, t.{col} AS w, t.alpha, t.stop FROM tokens t
            JOIN documents d ON d.id=t.doc_id WHERE d.corpus_id=? ORDER BY t.doc_id, t.pos""",
        (corpus_id,))
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


def keyness(conn, corpus_id, ref_id, unit="lemma", min_freq=3, exclude_stop=True,
            pos=None, limit=300):
    """Log-likelihood keyness of this corpus against a reference corpus."""
    t = frequency(conn, corpus_id, unit, pos, 1, exclude_stop, True, 10**9)
    r = frequency(conn, ref_id, unit, pos, 1, exclude_stop, True, 10**9)
    ref = {x["item"]: x["freq"] for x in r}
    c1, c2 = max(corpus_size(conn, corpus_id), 1), max(corpus_size(conn, ref_id), 1)
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
    out.sort(key=lambda r: -r["ll"])
    return out[:limit]
