"""Command line: load big sentence files into a language's base (reference) corpus.

    uv run colloca-import-reference --lang es spa_news_2023_300K-sentences.txt --max-sentences 300000

Unlike the web upload this streams the file from disk, so it has no size limit. Run it with the same
COLLOCA_DATA_DIR as the server (in Docker: `docker compose run --rm colloca colloca-import-reference ...`).
"""
import argparse
import itertools
import sys
from pathlib import Path

from . import analysis, db, importer, nlp


def _count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(1 for _ in fh)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="colloca-import-reference", description=__doc__.split("\n\n")[0])
    ap.add_argument("--lang", required=True, choices=sorted(nlp.SUPPORTED))
    ap.add_argument("files", nargs="+", type=Path, help="sentence files: one sentence per line, or Leipzig "
                                                       "'<id><TAB><sentence>' lines")
    ap.add_argument("--max-sentences", type=int, default=0, help="stop after this many sentences per file (0 = all)")
    ap.add_argument("--name", default="", help="name for the base corpus if it has to be created")
    ap.add_argument("--force-language", action="store_true", help="import even if the language looks wrong")
    args = ap.parse_args(argv)

    db.init_db()
    with db.session() as conn:
        corpus = analysis.reference_corpus(conn, args.lang)
        if corpus:
            corpus_id = corpus["id"]
        else:
            name = args.name or f"General {nlp.SUPPORTED[args.lang]} (base corpus)"
            corpus_id = conn.execute(
                "INSERT INTO corpora (name,lang,description,is_reference) VALUES (?,?,?,1)",
                (name, args.lang, "General-language reference corpus")).lastrowid
            print(f"Created base corpus '{name}'", file=sys.stderr)

    status = 0
    for path in args.files:
        if not path.is_file():
            print(f"{path}: not a file", file=sys.stderr)
            status = 1
            continue
        total = _count_lines(path)
        if args.max_sentences:
            total = min(total, args.max_sentences)
        n_chunks = importer.count_chunks(total)

        def show(fraction: float, name=path.name, n=n_chunks) -> None:
            print(f"\r{name}: {fraction:6.1%} ({n} parts)", end="", file=sys.stderr, flush=True)

        with path.open(encoding="utf-8", errors="replace") as fh:
            sentences = importer.parse_sentences(fh)
            if args.max_sentences:
                sentences = itertools.islice(sentences, args.max_sentences)
            try:
                res = importer.import_sentence_chunks(
                    corpus_id, importer.chunk_sentences(sentences), path.stem, path.name,
                    args.force_language, n_chunks, show)
            except importer.ImportRejected as exc:
                print(f"\n{path.name}: {exc.message}", file=sys.stderr)
                status = 1
                continue
        print(f"\n{path.name}: {res['documents']} parts, {res['tokens']:,} words"
              + (f", {res['skipped_duplicates']} duplicate parts skipped" if res["skipped_duplicates"] else ""),
              file=sys.stderr)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
