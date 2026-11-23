# Colloca (MVP)

Self-hosted web tool for translators to build **monolingual reference corpora** (Spanish, Italian)
from hand-picked URLs and client documents, and explore them: frequency, concordance (KWIC),
collocations, n-grams / phraseology, keyness and word clouds.

Everything stays on your machine: one SQLite file in a Docker volume, no external services
(except fetching the URLs you ask for).

## Run

```bash
docker compose up --build        # first build downloads the spaCy models
# open http://localhost:8000
```

Use faster/smaller models with `SPACY_SIZE=sm` (edit `docker-compose.yml`). Data lives in the
`colloca-data` volume; back it up with `docker run --rm -v colloca-data:/d -v $PWD:/b alpine tar czf /b/colloca-backup.tgz -C /d .`.

## Workflow

1. **New corpus** (name + language), e.g. "Client X – wind energy [es]".
2. **Sources**: paste a URL → *Fetch & preview* → trim noise in the text box → *Add*.
   Or upload DOCX / PDF (text layer) / TXT / HTML. Exact duplicates are rejected.
3. Explore with the tabs. Click any word in a table to jump to its concordance. Every table has a CSV export.
4. **Keyness**: create a second corpus (same language, e.g. a general one) and compare.

## Measures

| Analysis | Details |
|---|---|
| Frequency | by lemma or form, per million, number/percentage of documents containing it (dispersion), POS filter |
| Concordance | words or phrases (up to 6 words), match on lemma or exact form, sort by left/right context |
| Collocations | single node lemma, window L/R inside the sentence; logDice (sort key), MI, t-score, log-likelihood |
| N-grams | 2–6 words within a sentence; min frequency / min documents; stopword edges trimmed by default |
| Keyness | log-likelihood + log ratio against another corpus of the same language |

## Development

Tooling: [mise](https://mise.jdx.dev) (Python 3.14 + uv) and [uv](https://docs.astral.sh/uv/) for dependencies.

```bash
mise install                  # Python 3.14 and uv
mise run sync                 # uv sync: dependencies + spaCy models (sm)
mise run test                 # uv run pytest
mise run dev                  # uvicorn with auto-reload on http://localhost:8000
```

The loader falls back to whichever installed model size is available (`SPACY_SIZE` sets the preferred one).
Add dependencies with `uv add <pkg>`; `uv.lock` is committed.

Layout (`src` layout): `src/colloca/ingest.py` (URL/DOCX/PDF → text), `nlp.py` (spaCy),
`analysis.py` (all statistics, SQL + Python), `main.py` (API), `static/` (UI, no build step);
tests in `tests/`.

## Known limitations

- No OCR: scanned PDFs are rejected. No JavaScript rendering for URLs (pages that need it fail to extract).
- Extraction is heuristic: always review the preview. URL fetching respects no robots.txt (you choose the URLs);
  it blocks private/internal addresses (`ALLOW_PRIVATE_URLS=1` to override). No authentication: bind to localhost only.
- Small spaCy models make lemma/POS errors; use `md`/`lg` for better quality. Language is not auto-detected;
  a wrong-language document is annotated with the corpus language model.
- No synonym/related-term module yet (planned: thesaurus + embeddings, labelled as "related terms").
- Imports are synchronous (a large document blocks its request for a few seconds).
