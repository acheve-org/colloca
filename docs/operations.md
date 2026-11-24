# Operations

## Backup and trash

- Data lives in the `colloca-data` volume (`COLLOCA_DATA_DIR`).
- **Backup and Trash** screen:
  - Whole database: zip with a consistent copy of the database.
  - Single projects: export and import.
  - Optional passphrase for encrypted backups: [security.md](security.md#encrypted-backups).
- Volume-level backup:

```bash
docker run --rm -v colloca-data:/d -v $PWD:/b alpine tar czf /b/colloca-backup.tgz -C /d .
```

- Deleted corpora, documents and terms stay in the Trash 30 days (adjustable), then are removed.

## Database upgrades

- Schema versioned with `PRAGMA user_version`; migrations in `db.py`.
- Before migrating, a copy is written beside the database: `corpus.db.bak-v<old version>`.
- A database from a newer Colloca is refused, not corrupted.

## Logging

| Variable | Effect |
|---|---|
| `COLLOCA_LOG_LEVEL` | Default `INFO`. |
| `COLLOCA_LOG_FORMAT=json` | One JSON object per line. |
| `COLLOCA_SLOW_MS` | Default 1000; `0` = off. Slower requests and concordance queries log as warnings. |

- Import and analysis jobs log when queued, started, done, rejected.
- 5xx responses and job crashes log with stack trace.

## Offline spaCy models

For installs without GitHub access at build time:

```bash
# on a machine with internet (--dry-run lists URLs)
uv run python scripts/fetch_model_wheels.py wheels --size lg            # es and it
uv run python scripts/fetch_model_wheels.py wheels --size lg --langs fr de   # other catalog languages
# on the target
uv pip install --no-index --find-links wheels es_core_news_lg it_core_news_lg
```

- Docker: mount the directory, set `SPACY_WHEELS=/wheels`. The Languages screen and `download-models` install from it instead of downloading.
- OCR data offline: put the `<code>.traineddata` files in a directory and set `TESSDATA_FILES` to it.

## Performance

Scripts:

```bash
uv run python scripts/make_sample_corpus.py --lang es --words 1m --db /tmp/s.db   # synthetic, seeded; 100k, 1m, 5m or any number; 1M words < 10 s
uv run python scripts/bench_analyses.py --words 1m                                # times every analysis; touches no data outside its temporary database
```

Timings in ms (synthetic Spanish corpus, one run, Apple-silicon laptop, SQLite, no precomputed counts; before → after an optimisation):

| Analysis | 1M words | 5M words |
|---|---:|---:|
| frequency (lemma) | 653 → 546 | 3,620 → 2,998 |
| frequency (form) | 989 → 881 | 5,422 → 4,619 |
| concordance, frequent / mid / rare word | 13 / 8 / 1 (unchanged) | 32 / 15 / 6 (unchanged) |
| concordance, wildcard | 69 → 64 | 354 → 343 |
| collocations, frequent word | 429 → 432 | 2,291 → 2,244 |
| collocations, mid word | 398 → 302 | 2,134 → 2,130 |
| n-grams (3, form) | 2,048 → 1,655 | 10,330 → 9,213 |
| keyness vs reference | 912 → 878 | 4,660 → 4,686 |
| coverage / job analysis | 606 → 542 | 1,829 → 1,811 |

- 1M words: nothing over 5 s.
- 5M words: slow are n-grams (~9 s) and `form` frequency (4.6 s). Cost is a scan of `tokens`; a precomputed per-corpus count table would be the next step.
- Concordance stays in milliseconds (lemma/form indexes).
- Results identical before and after (compared on a generated corpus; statistics tests unchanged).

## Known limitations

| Area | Limitation |
|---|---|
| OCR | Optional ([importing.md](importing.md#ocr-optional)); accuracy depends on the scan. |
| URLs | No JavaScript rendering: pages that need it fail to extract. Extraction is heuristic: review the preview. No `robots.txt` handling (you choose the URLs). |
| URL safety | Private/internal addresses blocked (`ALLOW_PRIVATE_URLS=1` overrides). The name is resolved once per request and the connection goes to that address (certificates still verified against the host name), so DNS changes cannot reach internal addresses. |
| Authentication | None unless `COLLOCA_PASSWORD` is set ([security.md](security.md)); otherwise bind to localhost only. |
| Models | `sm` models make lemma/POS errors; use `lg` (Docker default). |
| Language check | Compares stop words of the languages you set up; needs at least two ([importing.md](importing.md#checks-on-import)). |
| Jobs | Kept in memory; a restart forgets their status. Imported documents stay. |
