# Job analysis

The **Job** screen analyses a text you are about to translate. Input: DOCX, PDF, TXT, HTML, or pasted text.

The report compares it with the current corpus (narrowed by the document filter) and the project's termbase.

| Section | Content |
|---|---|
| Coverage | Share of content words whose lemma occurs ≥ *N* times in the corpus (default 3); share seen at all; number of distinct words below the threshold. |
| Gaps | Words with little or no corpus evidence, least first. **+ Term** button each. |
| Key terms | Words characteristic of the text versus the language's base corpus (log-likelihood, ≥2 occurrences). No base corpus: most frequent words instead. |
| Termbase terms | Entries whose source term occurs (word form or lemma): count, first sentence, all translations with status. Forbidden ones struck through. |
| Repeated phrases | 2–4 words, no stopword at the edges, with the corpus's existing use. |

*Glossary for this job* exports the termbase terms as TBX, Excel or CSV.

## Privacy

- The text is analysed, then forgotten. Nothing is added to any corpus; by default nothing is kept.
- Runs as a background job.

## API

| Call | Purpose |
|---|---|
| `POST /api/corpora/{id}/analyse-job` | Start. |
| `GET /api/jobs/{id}/result` | Report. |
| `...?section=gaps\|key_terms\|known_terms\|phrases&format=csv` | One table as CSV. |
| `...?format=xlsx` | Whole report as one workbook (Summary sheet + one sheet per table; cells always text). Also per saved report. |

## Saved reports

- *Save report* stores the report (not the text). It appears under *Saved reports*; *Open* restores it after a restart or reload. Table flags (in termbase, dropped) are recomputed on open.
- **Keep the text**: tick *keep the text with a saved report* **before** analysing. *Show the text* then displays it with termbase hits underlined and forbidden translations struck through (same as *Check text*).
  - Off by default: client texts are confidential.
  - Text exists in memory only until you save.
  - Deleting a report deletes its text.
- Reports are removed when their corpus is deleted for good.
- Included in a full SQLite backup; not in the portable `data.json` (re-run after restore).
- *Leverage estimate*: see [aligned-texts.md](aligned-texts.md#segment-lookup-match-percentages).
