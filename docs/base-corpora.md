# Base corpora

A base corpus is a general-language reference, one per language. It answers: is this word domain vocabulary or ordinary language?

- Kept apart from your corpora: not in the corpus selector, never mixed into their concordances, frequencies or n-grams.
- Used by:
  - **Keyness**: default reference (another corpus can be chosen).
  - **Frequency, Collocations**: tick *compare with base corpus* to add *Base per M*.
  - **Job analysis**: key terms.

## Importing

*Base corpora* screen. Input: sentence files (one sentence per line, or Leipzig `<id><TAB><sentence>`), split into documents of 5000 sentences.

| Route | Limit |
|---|---|
| Web upload | 25 MB per file |
| Command line | Streams from disk; any size |

```bash
uv run colloca-import-reference --lang es spa_news_2023_300K-sentences.txt --max-sentences 300000
# Docker
docker compose run --rm -v "$PWD/corpora:/in" colloca colloca-import-reference --lang es /in/spa_news_2023_300K-sentences.txt
```

- Colloca downloads nothing. Get a file and check its licence (Leipzig files: CC BY).
- 300k sentences (~7M words) take over 30 minutes to annotate with `sm`. Start with `--max-sentences 100000`.
- Sentences are shuffled: *Docs* columns are meaningless for base corpora.

## Recipe: a reliable base corpus

Aim: **general, large, clean, varied**.

**Files** (Leipzig Corpora Collection, <https://wortschatz.uni-leipzig.de>, CC BY; the list changes yearly):

| Language | Files |
|---|---|
| Spanish | `spa_news_<year>_*`, `spa_web_<year>_*`, `spa_wikipedia_<year>_*` |
| Italian | `ita_news_<year>_*`, `ita_web_<year>_*`, `ita_wikipedia_<year>_*` |

**Size and mix**: ~250k sentences per language (~5M words), e.g. 100k news + 100k web + 50k Wikipedia, capped with `--max-sentences`. Beyond 300k adds little and slows annotation.

**Rules**:

| Rule | Why |
|---|---|
| Match register to your work; mix news, web, Wikipedia. | News alone flags "formal" words as key terms in legal, technical, commercial texts. |
| One year or period per source. | Vocabulary drifts. |
| One file per source and type. | The 300K file contains the 100K file; both would count sentences twice. |
| Never add your own documents. | Shrinks the contrast keyness shows. |
| Use your target's language variety (European Spanish for Spain). | Regional words become key terms. |
| Credit the source (CC BY); use `lg` models (Docker default). | Same lemmatisation in base and corpora. |

**Sanity check**: run Keyness of a small neutral text (a general article) against the base. Expect few or no key terms; many means the base is too narrow or its register is off.
