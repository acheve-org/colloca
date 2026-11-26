"""Time every analysis on a synthetic corpus and print a table (measures only; changes nothing).

    uv run python scripts/bench_analyses.py --lang es --words 1m
    uv run python scripts/bench_analyses.py --db /tmp/sample.db --corpus 1 --repeat 3

Without --db a temporary database is generated first (seeded, so runs are comparable). A reference corpus a
quarter of the size is generated too, for keyness. Each analysis runs --repeat times; the best time is reported.
"""
import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from make_sample_corpus import build, words_arg  # noqa: E402

from corpora import analysis, db, jobanalysis  # noqa: E402


def timed(fn, repeat: int):
    best, result = float("inf"), None
    for _ in range(repeat):
        t0 = time.perf_counter()
        result = fn()
        best = min(best, time.perf_counter() - t0)
    return best, result


def _size(res) -> str:
    """Rows returned (hits found, for a concordance)."""
    if isinstance(res, dict):
        if "total" in res:
            return f"{res['total']:,} hits"
        for key in ("rows", "lines", "items"):
            if isinstance(res.get(key), list):
                return f"{len(res[key]):,} rows"
        return ""
    return f"{len(res):,} rows" if hasattr(res, "__len__") else ""


def cases(conn, corpus: int, ref: int | None, lang: str):
    top = analysis.frequency(conn, corpus, unit="lemma", exclude_stop=True, limit=2000)
    lemmas = [r["item"] for r in top]
    common, mid, rare = lemmas[0], lemmas[min(100, len(lemmas) - 1)], lemmas[-1]
    text = " ".join(lemmas[:200] + lemmas[-100:]) * 2 + "."
    out = [
        ("frequency (lemma)", lambda: analysis.frequency(conn, corpus, unit="lemma")),
        ("frequency (form)", lambda: analysis.frequency(conn, corpus, unit="form", exclude_stop=False)),
        ("concordance, frequent word", lambda: analysis.concordance(conn, corpus, common)),
        ("concordance, mid word", lambda: analysis.concordance(conn, corpus, mid)),
        ("concordance, rare word", lambda: analysis.concordance(conn, corpus, rare)),
        ("concordance, sorted right1", lambda: analysis.concordance(conn, corpus, mid, sort="r1")),
        ("concordance, two words any order", lambda: analysis.concordance(conn, corpus, f"{mid} {lemmas[50]}",
                                                                          any_order=True)),
        ("concordance, wildcard", lambda: analysis.concordance(conn, corpus, mid[:3] + "*", unit="form")),
        ("collocations, frequent word", lambda: analysis.collocations(conn, corpus, common)),
        ("collocations, mid word", lambda: analysis.collocations(conn, corpus, mid)),
        ("n-grams (3, form)", lambda: analysis.ngrams(conn, corpus, n=3)),
        ("n-grams (4, lemma)", lambda: analysis.ngrams(conn, corpus, n=4, unit="lemma")),
    ]
    if ref:
        out.append(("keyness vs reference", lambda: analysis.keyness(conn, corpus, ref)))
        out.append(("coverage / job analysis", lambda: jobanalysis.analyse(
            conn, corpus, conn.execute("SELECT * FROM corpora WHERE id=?", (corpus,)).fetchone(), text)))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--lang", choices=("es", "it"), default="es")
    ap.add_argument("--words", type=words_arg, default=1_000_000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--db", help="existing database (default: generate a temporary one)")
    ap.add_argument("--corpus", type=int, help="corpus id inside --db (default: the largest)")
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args(argv)

    tmp = None
    path, ref = args.db, None
    if not path:
        tmp = tempfile.TemporaryDirectory()
        path = os.path.join(tmp.name, "bench.db")
        t0 = time.perf_counter()
        corpus = build(path, args.lang, args.words, args.seed)
        ref = build(path, args.lang, max(args.words // 4, 1000), args.seed + 1, name="Reference", reference=True)
        print(f"generated {args.words:,} + {max(args.words // 4, 1000):,} words in {time.perf_counter() - t0:.1f}s",
              file=sys.stderr)
    conn = db.connect(path)
    try:
        if args.db:
            corpus = args.corpus or conn.execute(
                "SELECT corpus_id FROM documents GROUP BY corpus_id ORDER BY SUM(n_tokens) DESC").fetchone()[0]
            r = analysis.reference_corpus(conn, conn.execute("SELECT lang FROM corpora WHERE id=?",
                                                             (corpus,)).fetchone()[0])
            ref = r["id"] if r else None
        n = analysis.corpus_size(conn, corpus)
        rows = []
        for name, fn in cases(conn, corpus, ref, args.lang):
            try:
                secs, res = timed(fn, args.repeat)
                size = _size(res)
                rows.append((name, f"{secs * 1000:,.0f}", str(size)))
            except Exception as exc:  # report, keep going
                rows.append((name, "error", f"{type(exc).__name__}: {exc}"[:50]))
    finally:
        conn.close()
        if tmp:
            tmp.cleanup()
    print(f"\nCorpus: {n:,} words ({args.lang}), best of {args.repeat}\n")
    print("| Analysis | ms | result size |\n|---|---:|---:|")
    for r in rows:
        print("| " + " | ".join(r) + " |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
