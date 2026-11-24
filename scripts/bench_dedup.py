"""Time near-duplicate detection on a synthetic corpus (measures only; changes nothing it keeps).

    uv run python scripts/bench_dedup.py --words 1m --docs 500
    uv run python scripts/bench_dedup.py --db /tmp/sample.db --corpus 1

Reports: fingerprinting the whole corpus (the lazy backfill of documents added before migration v9), the check an
import makes against all stored sketches, and the all-pairs report. Without --db a temporary database is generated.
"""
import argparse
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from make_sample_corpus import build, words_arg  # noqa: E402

from colloca import db, dedup  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--lang", choices=("es", "it"), default="es")
    ap.add_argument("--words", type=words_arg, default=1_000_000)
    ap.add_argument("--docs", type=int, default=0, help="documents to generate (default: by size)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--db")
    ap.add_argument("--corpus", type=int)
    args = ap.parse_args(argv)
    path = args.db or str(Path(tempfile.mkdtemp()) / "bench.db")
    if not args.db:
        build(path, args.lang, args.words, args.seed, n_docs=args.docs)
    conn = db.connect(path)
    conn.row_factory = __import__("sqlite3").Row
    cid = args.corpus or conn.execute("SELECT corpus_id FROM documents GROUP BY corpus_id "
                                      "ORDER BY SUM(n_tokens) DESC").fetchone()[0]
    conn.execute("UPDATE documents SET fingerprint=NULL WHERE corpus_id=?", (cid,))
    docs, chars = conn.execute("SELECT COUNT(*), SUM(LENGTH(text)) FROM documents WHERE corpus_id=?", (cid,)).fetchone()
    print(f"corpus {cid}: {docs} documents, {chars / 1e6:.1f} MB of text")

    t0 = time.perf_counter()
    n = dedup.ensure_fingerprints(conn, cid)
    t = time.perf_counter() - t0
    print(f"fingerprint {n} documents: {t:.2f} s ({chars / 1e6 / t:.1f} MB/s)")

    text = conn.execute("SELECT text FROM documents WHERE corpus_id=? ORDER BY LENGTH(text) DESC", (cid,)).fetchone()[0]
    edited = text[: len(text) // 2] + " párrafo nuevo añadido para la prueba " + text[len(text) // 2:]
    t0 = time.perf_counter()
    sk = dedup.sketch(edited)
    t_sk = time.perf_counter() - t0
    known = [(r["id"], r["fingerprint"]) for r in conn.execute(
        "SELECT id, fingerprint FROM documents WHERE corpus_id=?", (cid,))]
    t0 = time.perf_counter()
    found = dedup.find_similar(sk, known, dedup.THRESHOLD)
    t_cmp = time.perf_counter() - t0
    print(f"import check of a {len(edited) / 1e6:.2f} MB text: sketch {t_sk * 1000:.0f} ms, "
          f"compare with {len(known)} stored sketches {t_cmp * 1000:.0f} ms -> {len(found)} match(es)"
          f"{' (best %.0f%%)' % (found[0][1] * 100) if found else ''}")

    t0 = time.perf_counter()
    rep = dedup.report(conn, cid, dedup.THRESHOLD)
    print(f"all-pairs report: {time.perf_counter() - t0:.2f} s -> {len(rep['pairs'])} pair(s)")
    conn.rollback()
    return 0


if __name__ == "__main__":
    sys.exit(main())
