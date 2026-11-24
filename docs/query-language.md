# Advanced query language (T13)

Switch on **Advanced query** in the concordance (API: `advanced=true` on `/concordance` and `/bilingual`) to search
by token instead of by plain words. The interface shows the query back in words as you type and points at the
character of a mistake. A query never crosses a sentence boundary. **Any order** and the advanced syntax cannot be
combined (use gaps). It is not a full CQL: there are no parentheses, no `within`, no back-references.

## Grammar

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

- In `[lemma="..."]` and `[form="..."]` the value is a **regular expression that must match the whole word**
  (`"contrat.*"`, `"tom(ar|a)"`). Python syntax, at most 100 characters; a group that repeats and itself repeats,
  as in `(a+)+`, is refused. Inside the quotes write `\"` for a quote.
- `pos="NOUN|VERB"` takes Universal POS tags: ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN PUNCT SCONJ SYM
  VERB X. In the friendly form a bare upper-case word that is a tag means that tag; write `"NOUN"` for the word.
- Bare words follow the **Unit** setting (lemma or form). `form` is the written word, matched case-insensitively
  unless **Case sensitive** is on. `lemma` is always lower case.
- Tokens written next to each other must be adjacent words; gaps loosen that.

## Examples

| Query | In words |
|---|---|
| `[lemma="tomar"] []{0,3} [pos="NOUN"]` | lemma "tomar", then 0 to 3 words, then a noun |
| `tomar +3 NOUN` | the same, friendly form |
| `[lemma="tomar" & pos="VERB"]` | lemma "tomar" and part of speech verb |
| `[form="contrat.*"]` | word matching /contrat.*/ (contrato, contratos, contratación) |
| `/contrat(o\|os)/` | regex token on the Unit |
| `contrato\|contratos` | either word (use Unit = form) |
| `[lemma="tomar"\|lemma="coger"] DET NOUN` | tomar or coger, a determiner, a noun |
| `[lemma="tomar" & form!="toma"]` | forms of *tomar* except *toma* |
| `contrat* +1-3 [pos="ADJ"]` | a *contrat…* word, 1 to 3 words, an adjective |
| `[pos="DET"] [] [lemma="leche"]` | a determiner, exactly one word, then *leche* |

(`\|` inside a table cell is just `|`.)

## Accent-insensitive

**Ignore accents** (`accent_insensitive=true`, works with the simple and the advanced syntax): `cafe` finds *café*,
`decision` finds *decisión*. The tilde of **ñ** is kept (*año* is not *ano*). It cannot be combined with Case
sensitive. It uses expression indexes on the accent-stripped form and lemma, built by schema migration v8 from the
existing tokens (the first start after upgrading may take a moment on a very large corpus) and kept up to date by
SQLite on every import and re-annotation; no re-annotation is needed.

## Safety

Every query is compiled to one SQL `SELECT` over `tokens`. One token, the one with the longest fixed text, drives the
search through an index and the others are reached by primary-key lookups in the same sentence.

- A query must have **an anchor**: a token every alternative of which has a word, a lemma, or a pattern starting with
  at least 3 fixed letters (`contrat.*`, `tom(ar|a)`). A POS tag, `[]`, `!=`, `.*ado` or `/.*/` alone would scan the
  whole corpus and is refused, pointing at the first token.
- At most 6 tokens, gaps of at most 15 words, 300 characters, 50 000 hits (the response then has `capped: true`).
- The SQL is stopped after 10 seconds with a message asking for a more specific query.

## Errors

Mistakes are reported with the 1-based character position, for example
`A gap must span 1 to 15 words (at character 7)` for `tomar +99 NOUN`; the API answers 400 with that message as `detail`,
and `GET /api/query/explain?q=...&advanced=true` returns `{ok, parsed}` or `{ok: false, error, position}`.
