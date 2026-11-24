# Aligned texts and translation memories

Previous translations show how a client wants things said. Import them as aligned texts and search both sides.

## Import

*Sources* → *Import aligned texts*.

| Input | Notes |
|---|---|
| TMX | Matched by language code (`es`, `es-ES`, `it_IT`…). Inline markup dropped. Units missing a language skipped. |
| XLIFF 1.2 / 2.x (`.xlf`, `.xliff`) | `source-language`/`target-language` or `srcLang`/`trgLang`. Units without a target skipped. |
| Two columns (source \| target) | `.tsv`, `.csv` (comma, semicolon or tab), or a `.docx` table. Column order decides. Tick *this corpus is the second column* if reversed. |

- The current corpus receives the first language; the other texts go to a corpus you pick or create.
- Files over 5000 units are stored in parts.
- TMX is parsed with `defusedxml`: hostile files (entity bombs, external entities) are refused.

## Model

- Each side is a normal corpus in its own language: all analyses and the termbase work on it.
- Sides are linked segment by segment (segment N ↔ segment N). Re-annotating keeps the link. Removing one side's document unlinks the other.

## Align two documents

*Sources* → *Align two documents*. For when no TMX exists.

- Input: original + translation (DOCX, PDF with text layer, TXT, HTML).
- Method:
  - Both split into sentences (paragraph breaks first).
  - Matched by length (Gale and Church).
  - Anchors: numbers, names written the same on both sides, closing punctuation.
  - Link types: 1:1, 1:2, 2:1, 1:0, 0:1.
- The result is a **proposal**. The review table marks links to check with the word "Check" (not only colour). You can merge, split, delete, then confirm. Nothing is stored before that.
- Merged sentences become one segment joined by a space. Units with an empty side (1:0, 0:1) are not stored.
- Weak on very short or reordered text: check every marked link.

## Concordance: *Source + target*

Appears when the corpus has aligned texts. Run it on the target-language corpus to search by translation.

| Marking | Meaning |
|---|---|
| Query in source | Marked. |
| Approved termbase translation | Solid underline in target. Wins. |
| Best *Equivalents* candidate | Dotted underline + label *guess*. Statistical: check before adopting. In small memories several words can tie; the one most like the query is chosen. |
| Termbase term (KWIC and *Source + target*) | Underlined; approved translation on hover. Matches word forms, lemmas, multi-word terms. Project termbase, plus the general termbase. |
| Forbidden translation in target | Struck through + ⚠; approved alternative on hover. |

- Words match by lemma (*contratti* marks for *contrato*).
- *Check text* (Terms group) does the same for a pasted segment or draft.
- Server-side matching: `POST /api/corpora/{id}/check-text`; `source_terms`, `target_terms`, `left_terms`, `node_terms`, `right_terms` offsets in concordance responses.
- CSV exports unchanged.

## Equivalents

In the rail only when the corpus has aligned texts.

- Candidate translations of a word or phrase: target lemmas recurring in the aligned segments of its occurrences, scored by Dice against overall target frequency (everyday words score low).
- Single words only on the target side. A hint, not a verdict.
- Confirm in the translated concordance, then **+ Term** adds the pair with the example sentence.

## Segment lookup (match percentages)

*Explore > Segment lookup*. Visible when the corpus has aligned documents. API: `POST /api/corpora/{id}/segment-lookup`.

- Input: a source segment. The corpus you are in is the source side.
- Output, best first:
  - match percentage and band (100, 95–99, 85–94, 75–84, <75);
  - aligned translation;
  - word diff: blue underline = only in stored segment, strikethrough = only in yours;
  - *Open* shows the document at that segment.

| Calculation | Detail |
|---|---|
| Tokens | Words and numbers by the corpus tokenizer. Case, punctuation, inline tags (`<b>`, `{1}`, `%s`) ignored. |
| Score | Share of words unchanged by the fewest insertions, deletions, replacements (word-level Levenshtein), rounded down. |
| 100 | Same words. *identical* when the writing matches too. |
| Numbers | A differing number is an ordinary change; flagged *numbers differ* when it is the only one. |
| Candidates | From the word index: segments sharing words, most shared first, max 400 scored. Milliseconds to ~1 s. A segment sharing no word is not found. |

- Not the figure your CAT tool would give. Writes nothing to any corpus.
- **Leverage estimate** (Job screen): tick *estimate leverage from aligned texts* (`leverage=true` on `analyse-job`). The report adds the share of words in sentences with ≥75 % match; sentences per band in the tooltip. Up to 1,500 sentences looked up; may be slow.

## Export as TMX

*Sources > Export aligned texts (TMX)*: `GET /api/corpora/{id}/export-tmx`.

- TMX 1.4b. This corpus's language is the source.
- Each unit carries document title, source, text type, date, author, tags as `prop`s. Project name in the header.
- Imported TMX keeps its inline markup (formatting codes, placeholders) beside the plain text and writes it back on export (switchable off). Import → export → import gives the same segments.
- Several partner corpora: choose with `partner_corpus_id`. The document filter narrows the documents.
- Verified: structure against the TMX 1.4b DTD content model in tests.
- Not verified: the official DTD file itself; opening an export in any CAT tool.
