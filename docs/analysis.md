# Analyses

## Measures

| Analysis | Detail |
|---|---|
| Frequency | By lemma or form. Per million, document count and %, POS filter. |
| Concordance | Words or phrases (up to 6 words). Match on lemma or exact form. |
| Collocations | One node lemma, window L/R inside the sentence. logDice (sort key), MI, t-score, log-likelihood. |
| N-grams | 2–6 words within a sentence. Min frequency, min documents. Stopword edges trimmed by default. |
| Keyness | Log-likelihood + log ratio against another corpus of the same language. |
| Related terms | Statistical neighbours of a lemma. See below. |

## Concordance options

All are API parameters too.

| Option | API | Behaviour |
|---|---|---|
| Case sensitive | `case_sensitive=true` | Matches the written form: *Contrato* ≠ *contrato*. |
| Wildcard `*` | | At word start and/or end: `contrat*`, `*miento`. At least 3 letters besides `*`. `*` mid-word refused. `?` and `[` are literal. |
| Any order | `any_order=true` | All query words in one sentence, any order. Node spans first to last. Not combinable with advanced. |
| Advanced query | `advanced=true` | Token syntax. [Below](#advanced-query-language). |
| Ignore accents | `accent_insensitive=true` | `cafe` finds *café*. ñ stays distinct from n. Works with both syntaxes. Not combinable with case sensitive. |
| Hits | | 100, 500 or 2000. Total found is always shown. |
| Random sample | `sample=<seed>` | Same seed, same selection. *New sample* draws another. |
| Sort | | Document, whole left/right context, or 1st/2nd word left/right (`l1 l2 r1 r2`). |
| Filter boxes | | Narrow loaded lines (left/right context; source/target when aligned). No new search. Not in CSV export. |

Selecting a hit shows document metadata (source, author, date, text type, tags) and the full sentence.
**Open document** shows the text around the hit with the match marked (aligned documents: translation beside each segment), with *Previous / Next hit* and *Show more before / after*. API: `GET /api/documents/{id}/context?pos=&span=&radius=` (surrounding sentences only).

## Advanced query language

- Enabled with `advanced=true` on `/concordance` and `/bilingual`.
- The interface echoes the query in words and marks the character of a mistake.
- A query never crosses a sentence boundary.
- Not full CQL: no parentheses, `within` or back-references.

### Grammar

```
query  := item+                      (starts and ends with a token; at most 6 tokens)
token  := '[' cond ']'               a condition on one word
        | WORD                       friendly form: contrato, contrat*, *miento, a|b
        | '"' text '"'               a literal word (no wildcard, no |)
        | '/' regex '/'              a regex on the Unit (lemma or form)
        | POS                        a bare upper-case tag: NOUN, VERB, ADJ ...
gap    := '[]'                       exactly one word
        | '[]{n}' | '[]{m,n}' | '[]?'     n, or m to n words (n at most 15)
        | '+N'                       0 to N words between the two neighbours (friendly form)
        | '+M-N'                     M to N words between
cond   := and ('|' and)*             or
and    := atom ('&' atom)*           and
atom   := ATTR '=' "value" | ATTR '!=' "value"
ATTR   := lemma | form (or word) | pos
```

| Rule | Detail |
|---|---|
| `lemma`, `form` values | Regex that must match the whole word. Python syntax, max 100 characters. Nested repeats such as `(a+)+` refused. `\"` for a quote. |
| `pos` values | Universal POS: ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN PUNCT SCONJ SYM VERB X. |
| Bare upper-case word | A tag if it is one; write `"NOUN"` for the word. |
| Bare words | Follow the **Unit** setting (lemma or form). |
| `form` | Written word, case-insensitive unless *Case sensitive*. |
| `lemma` | Always lower case. |
| Adjacent tokens | Must be adjacent words; gaps loosen that. |

### Examples

| Query | Meaning |
|---|---|
| `[lemma="tomar"] []{0,3} [pos="NOUN"]` | *tomar*, 0–3 words, a noun |
| `tomar +3 NOUN` | Same, friendly form |
| `[lemma="tomar" & pos="VERB"]` | Lemma *tomar* and verb |
| `[form="contrat.*"]` | *contrato*, *contratos*, *contratación* |
| `/contrat(o\|os)/` | Regex on the Unit |
| `contrato\|contratos` | Either word (Unit = form) |
| `[lemma="tomar"\|lemma="coger"] DET NOUN` | *tomar* or *coger*, determiner, noun |
| `[lemma="tomar" & form!="toma"]` | Forms of *tomar* except *toma* |
| `contrat* +1-3 [pos="ADJ"]` | *contrat…*, 1–3 words, adjective |
| `[pos="DET"] [] [lemma="leche"]` | Determiner, one word, *leche* |

(`\|` in a table cell is `|`.)

### Safety

- Each query compiles to one SQL `SELECT` over `tokens`. The token with the longest fixed text drives an index search; the others are primary-key lookups in the same sentence.
- **Anchor required**: a token whose every alternative has a word, a lemma, or a pattern starting with 3+ fixed letters (`contrat.*`, `tom(ar|a)`). A bare POS tag, `[]`, `!=`, `.*ado` or `/.*/` is refused, pointing at the first token.
- Limits: 6 tokens, gaps up to 15 words, 300 characters, 50 000 hits (`capped: true`).
- SQL stops after 10 s with a request for a more specific query.

### Errors

- Position is 1-based: `A gap must span 1 to 15 words (at character 7)` for `tomar +99 NOUN`.
- API: HTTP 400, message in `detail`.
- `GET /api/query/explain?q=...&advanced=true` returns `{ok, parsed}` or `{ok: false, error, position}`.

### Accent-insensitive search internals

- Expression indexes on the accent-stripped form and lemma, built by schema migration v8 (first start after upgrade may be slow on very large corpora).
- Maintained by SQLite on import and re-annotation. No re-annotation needed.

## Related terms

*Explore > Related terms*: `GET /api/corpora/{id}/related?q=<lemma>`.

- Suggests words used in similar contexts (synonyms, sister terms, sometimes antonyms or same-field words).
- Statistical drafting aid, labelled as such. Not a thesaurus.
- Adds nothing to the termbase; *+ Term* opens the usual dialog.

| Source | How it works | Notes |
|---|---|---|
| **This corpus** | Word vectors trained locally: content lemmas (no stop words) co-occurring within 5 words (nearer weigh more) → PPMI → randomised SVD, ≤100 dimensions. Ranked by cosine similarity; POS filter. Optional *add the base corpus*. | Top 4,000 content lemmas with ≥3 occurrences. Respects document filter. Trains in seconds, cached until the corpus changes. Learns *your* usage. Warns under ~100,000 content words; a few thousand words give nothing useful. |
| **Language model** | Vectors shipped with spaCy `md` and `lg`. | General language. No POS or frequency shown. `sm` has none; the screen says so. |

- Not included: a thesaurus as third source (data file with its own licence; not checked).
- Tested on synthetic corpora and a hand-made vector table. Quality on real corpora and with `md`/`lg` vectors is not measured.
