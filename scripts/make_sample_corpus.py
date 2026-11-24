"""Build a synthetic annotated corpus in a Colloca database (see colloca.samplegen).

    uv run python scripts/make_sample_corpus.py --lang es --words 1m --db /tmp/sample.db
    COLLOCA_DATA_DIR=/tmp/colloca-sample uv run python scripts/make_sample_corpus.py --lang it --words 5m
"""
import argparse
import sys
import time

from colloca import db, samplegen


def words_arg(value: str) -> int:
    v = value.lower().replace("_", "")
    if v in samplegen.SIZES:
        return samplegen.SIZES[v]
    for suffix, mult in (("k", 1_000), ("m", 1_000_000)):
        if v.endswith(suffix):
            return int(float(v[:-1]) * mult)
    return int(v)


def build(path: str, lang: str, words: int, seed: int, name: str = "", reference: bool = False, n_docs: int = 0) -> int:
    conn = db.connect(path)
    try:
        db.migrate(conn)
        name = name or f"Sample {lang} {words} (seed {seed})"
        cid = conn.execute("INSERT INTO corpora (name,lang,description,is_reference) VALUES (?,?,?,?)",
                           (name, lang, "Synthetic corpus", int(reference))).lastrowid
        samplegen.generate(conn, cid, lang, words, seed=seed, n_docs=n_docs)
        conn.commit()
        return cid
    finally:
        conn.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--lang", choices=("es", "it"), default="es")
    ap.add_argument("--words", type=words_arg, default=samplegen.SIZES["1m"], help="100k, 1m, 5m or a number")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--docs", type=int, default=0, help="number of documents (default: about one per 10k words)")
    ap.add_argument("--db", default=db.DB_PATH, help="SQLite file (default: COLLOCA_DATA_DIR/corpus.db)")
    ap.add_argument("--name", default="")
    ap.add_argument("--reference", action="store_true", help="make it the language's base corpus")
    args = ap.parse_args(argv)
    t0 = time.perf_counter()
    cid = build(args.db, args.lang, args.words, args.seed, args.name, args.reference, args.docs)
    print(f"corpus {cid}: {args.words:,} words ({args.lang}) in {args.db} [{time.perf_counter() - t0:.1f}s]",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
