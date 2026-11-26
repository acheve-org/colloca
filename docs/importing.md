# Importing documents

## Input formats

Accepted by *Upload files* on the *Add documents* page (*Sources* > *+ Add documents*) and *Analyse a job*.

| Format | Imported |
|---|---|
| `.docx`, `.odt`, `.rtf` | Body text and tables. ODT footnotes and comments are dropped. |
| `.pdf` | Text layer in reading order, with a quality score. No text layer: OCR. |
| `.xlsx`, `.csv`, `.tsv` | Text columns, one cell per line (all XLSX sheets). Columns of words are auto-detected; *Spreadsheet columns* overrides (`2,4` or `Texto`). Header row skipped. |
| `.xlf`, `.xliff` (1.2, 2.x) | Plain text of the side in the corpus language (target if it matches, else source). Inline codes removed. Pairs: use *Translation memory* on the *Add documents* page ([aligned-texts.md](aligned-texts.md)). |
| `.srt`, `.vtt` | One line per cue. Numbers, timings, tags, notes, styles dropped. |
| `.txt`, `.md`, `.html` | Text. |

- XML is parsed with `defusedxml` (no external entities).
- Size and page limits apply to all formats.

## PDF layout and quality

- **Reading order** (`pdftext.py`):
  - Lines rebuilt from positioned text runs.
  - Multi-column blocks read column by column; a full-width heading stays above its columns.
  - Three or more consecutive lines of short, aligned cells become table rows (`a | b | c`).
  - Running headers and page numbers removed.
- **Quality score** (0–100: *good*, *fair*, *poor*). Penalises undecodable characters, many symbols, words without vowels, words split into letters, very short lines, lines that stop mid-sentence.
  - URL and *Preview file* (one file in *Upload files*, via *Preview file*): score and reasons shown above the editable text.
  - Upload scoring below *good*: warning in the job.
- **Limits**:
  - Positions only (no ruling lines or font metrics): tables with long cells may read as columns.
  - Unusual text order is left as pypdf gives it.
  - The score is a guide.

## OCR (optional)

| Item | Detail |
|---|---|
| Trigger | PDF without text layer, extra and Tesseract installed. Otherwise the upload fails with a message naming what to install. |
| Engine | `pypdfium2` renders pages; `tesseract` reads in the corpus language, using the OCR code set for it in the Languages screen (`spa`, `ita`, …). |
| Report | Pages read, mean word confidence. Warning below 70 % (`OCR_MIN_CONFIDENCE`). |
| Limits | `MAX_OCR_PAGES` 100, `OCR_PAGE_TIMEOUT` 120 s per page. |
| Off switch | `OCR_ENABLED=0` |
| Speed | Seconds per page; runs as a background job. |

```bash
uv sync --extra ocr                                                  # pypdfium2 + Pillow
brew install tesseract tesseract-lang                                # macOS
sudo apt install tesseract-ocr                                       # Debian/Ubuntu; language data: Languages screen
docker build --build-arg WITH_OCR=1 -t colloca .                     # image ~100 MB larger
```

Check low-confidence OCR text before trusting lemmas.

## Checks on import

- **Language check**: each import is compared with the corpus language (spaCy stop words of the languages you set up).
  - Clear mismatch: rejected unless *import even if the language looks wrong* is ticked.
  - Unclear or very short: imported with a warning badge.
  - Result stored per document (`lang_check`).
  - Needs at least two languages set up; text in a language you have not set up is "unclear" or may be reported as the closest set-up language.
- **Near-duplicates**: besides identical texts, a MinHash sketch of 5-word shingles (case, punctuation, whitespace ignored; stored in `documents.fingerprint`).
  - At `NEAR_DUP_THRESHOLD` (default 85 %, range 0.5–1) the import stops. *Sources* (the job log) shows the older document, shared paragraphs and a few new or changed ones.
  - Choices: *Import anyway*, *Replace* (most similar older document), *Skip*.
  - Held file stays in server memory until decided (max 20, lost on restart).
  - *Find near-duplicates* (button above the document list on *Sources*) lists existing pairs: `GET /api/corpora/{id}/near-duplicates?threshold=`.
  - Older documents are fingerprinted on first use. Sentence files and aligned texts are not compared.
  - Estimate ±5 points on long texts. Measures shared wording: a short text inside a long one is not flagged.
  - Timing script: `scripts/bench_dedup.py`.
- **Limits** (environment variables):

  | Variable | Default |
  |---|---|
  | `MAX_UPLOAD_MB` | 25 per file |
  | `MAX_UPLOAD_FILES` | 50 per request |
  | `MAX_PDF_PAGES` | 1000 |
  | `MAX_TEXT_MB` | 10 per document |
  | `MAX_DOWNLOAD_MB` | 15 per URL |

- **Background imports**: uploads, URLs and pasted texts are queued, processed one at a time. After *Add documents* returns to *Sources*, its job log shows progress and per-file errors, whatever screen is open.
- **Check an import by reading it**: on *Sources*, select the document and choose *Read* in its side panel. The reader shows the stored text paragraph by paragraph (aligned documents as numbered pairs), so you can spot a page header repeated in every paragraph, OCR noise, broken lines or a misaligned pair. *Find in document* jumps to a word. Fix the metadata with *Edit details*; to fix the text, correct the source and import it again.
- **Re-annotate**: after changing `SPACY_SIZE` or updating spaCy, documents annotated with another model are flagged *older model*. *Re-annotate with current model* (`POST /api/corpora/{id}/reannotate`) redoes them from stored text.
