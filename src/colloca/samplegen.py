"""Synthetic annotated corpora for benchmarks and tests (Spanish and Italian).

The text is nonsense, but its statistics are realistic enough to load the database like a real corpus does: a
Zipf-like frequency curve over lemmas (function words on top), several inflected forms per lemma, sentences of
8-25 words ending in a punctuation token, and rows shaped exactly like the importer's (`tokens`, `documents`).
Everything derives from `seed`, so the same arguments give byte-identical corpora.

    uv run python scripts/make_sample_corpus.py --lang es --words 1000000 --db /tmp/sample.db
"""
import hashlib
import itertools
import random
import sqlite3

SIZES = {"100k": 100_000, "1m": 1_000_000, "5m": 5_000_000}

# (form, lemma, upos); stop words only, ordered roughly by real-life frequency
_FUNCTION = {
    "es": [("de", "de", "ADP"), ("la", "el", "DET"), ("que", "que", "SCONJ"), ("el", "el", "DET"),
           ("en", "en", "ADP"), ("y", "y", "CCONJ"), ("a", "a", "ADP"), ("los", "el", "DET"),
           ("se", "se", "PRON"), ("del", "del", "ADP"), ("las", "el", "DET"), ("un", "uno", "DET"),
           ("por", "por", "ADP"), ("con", "con", "ADP"), ("no", "no", "ADV"), ("una", "uno", "DET"),
           ("su", "su", "DET"), ("para", "para", "ADP"), ("es", "ser", "AUX"), ("al", "al", "ADP"),
           ("lo", "lo", "PRON"), ("como", "como", "SCONJ"), ("más", "más", "ADV"), ("o", "o", "CCONJ"),
           ("pero", "pero", "CCONJ"), ("sus", "su", "DET"), ("le", "le", "PRON"), ("ha", "haber", "AUX"),
           ("me", "me", "PRON"), ("si", "si", "SCONJ"), ("sin", "sin", "ADP"), ("sobre", "sobre", "ADP"),
           ("este", "este", "DET"), ("ya", "ya", "ADV"), ("entre", "entre", "ADP"), ("cuando", "cuando", "SCONJ"),
           ("también", "también", "ADV"), ("hasta", "hasta", "ADP"), ("desde", "desde", "ADP"),
           ("son", "ser", "AUX")],
    "it": [("di", "di", "ADP"), ("e", "e", "CCONJ"), ("il", "il", "DET"), ("che", "che", "SCONJ"),
           ("la", "il", "DET"), ("in", "in", "ADP"), ("a", "a", "ADP"), ("per", "per", "ADP"),
           ("un", "uno", "DET"), ("è", "essere", "AUX"), ("non", "non", "ADV"), ("con", "con", "ADP"),
           ("i", "il", "DET"), ("le", "il", "DET"), ("una", "uno", "DET"), ("da", "da", "ADP"),
           ("si", "si", "PRON"), ("del", "del", "ADP"), ("lo", "il", "DET"), ("dei", "dei", "ADP"),
           ("più", "più", "ADV"), ("come", "come", "SCONJ"), ("ma", "ma", "CCONJ"), ("o", "o", "CCONJ"),
           ("al", "al", "ADP"), ("sono", "essere", "AUX"), ("ha", "avere", "AUX"), ("anche", "anche", "ADV"),
           ("su", "su", "ADP"), ("nel", "nel", "ADP"), ("della", "della", "ADP"), ("se", "se", "SCONJ"),
           ("gli", "il", "DET"), ("alla", "alla", "ADP"), ("tra", "tra", "ADP"), ("quando", "quando", "SCONJ"),
           ("molto", "molto", "ADV"), ("dopo", "dopo", "ADP"), ("senza", "senza", "ADP"), ("fra", "fra", "ADP")],
}
_ONSETS = ["b", "c", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t", "v", "z", "br", "cr", "dr", "fr", "gr",
           "pr", "tr", "bl", "cl", "fl", "gl", "pl", "st", "sp", "sc", "ch", "qu"]
_NUCLEI = ["a", "e", "i", "o", "u", "ia", "io", "ie", "ue"]
_CODAS = ["", "", "", "n", "r", "s", "l"]
# upos -> (share of the vocabulary, lemma ending, forms)  ("" = the lemma itself)
_PATTERNS = {
    "es": {"NOUN": (0.45, "o", ["o", "os"]), "VERB": (0.25, "ar", ["ar", "a", "an", "ado"]),
           "ADJ": (0.2, "ivo", ["ivo", "iva", "ivos", "ivas"]), "ADV": (0.1, "mente", ["mente"])},
    "it": {"NOUN": (0.45, "o", ["o", "i"]), "VERB": (0.25, "are", ["are", "a", "ano", "ato"]),
           "ADJ": (0.2, "ivo", ["ivo", "iva", "ivi", "ive"]), "ADV": (0.1, "mente", ["mente"])},
}
_FORM_SHARES = [0.55, 0.25, 0.13, 0.07]
_PUNCT = [".", ".", ".", ".", "?", "!"]


def _vocabulary(lang: str, n_lemmas: int, rng: random.Random):
    """Entries (form, lemma, upos, stop) in rank order, and a weight per entry."""
    patterns = _PATTERNS[lang]
    kinds = list(patterns)
    kind_weights = [patterns[k][0] for k in kinds]
    entries: list = []
    seen: set = set()
    for form, lemma, upos in _FUNCTION[lang]:
        entries.append((form, lemma, upos, 1))
    n_function = len(entries)
    while len(seen) < n_lemmas:
        stem = "".join(rng.choice(_ONSETS) + rng.choice(_NUCLEI) + rng.choice(_CODAS)
                       for _ in range(rng.choice((1, 2, 2, 3))))
        upos = rng.choices(kinds, kind_weights)[0]
        _, lemma_end, ends = patterns[upos]
        lemma = stem + lemma_end
        if lemma in seen:
            continue
        seen.add(lemma)
        for end in ends:
            entries.append((stem + end, lemma, upos, 0))
    # weights: function words take the head of the Zipf curve, then every lemma splits its mass among its forms
    weights, rank = [], n_function
    for rank in range(1, n_function + 1):
        weights.append(1.0 / rank)
    # content lemmas continue the same curve (entries of one lemma are adjacent)
    i = n_function
    while i < len(entries):
        lemma = entries[i][1]
        j = i
        while j < len(entries) and entries[j][1] == lemma:
            j += 1
        rank += 1
        mass = 1.0 / rank
        shares = _FORM_SHARES[: j - i]
        total = sum(shares)
        weights.extend(mass * s / total for s in shares)
        i = j
    return entries, weights


def _document(entries, cum_weights, n_words, rng, sent_len=(8, 25)):
    """Token tuples (pos, sent, form, norm, lemma, upos, alpha, stop, sp) and the text of one document."""
    picks = rng.choices(entries, cum_weights=cum_weights, k=n_words)
    tokens, parts, pos, sent, i = [], [], 0, 0, 0
    while i < n_words:
        length = min(rng.randint(*sent_len), n_words - i)
        for k, (form, lemma, upos, stop) in enumerate(picks[i:i + length]):
            shown = form.capitalize() if k == 0 else form
            last = k == length - 1
            tokens.append((pos, sent, shown, form, lemma, upos, 1, stop, 0 if last else 1))
            parts.append(shown + ("" if last else " "))
            pos += 1
        punct = rng.choice(_PUNCT)
        tokens.append((pos, sent, punct, punct, punct, "PUNCT", 0, 0, 1))
        parts.append(punct + " ")
        pos += 1
        sent += 1
        i += length
    return tokens, "".join(parts).strip()


def generate(conn: sqlite3.Connection, corpus_id: int, lang: str, words: int, *, seed: int = 0,
             n_docs: int = 0, n_lemmas: int = 0) -> int:
    """Fill an existing corpus with `words` alphabetic tokens. Returns the number of documents created."""
    if lang not in _FUNCTION:
        raise ValueError(f"lang must be one of {', '.join(_FUNCTION)}")
    if words < 1:
        raise ValueError("words must be positive")
    rng = random.Random(f"{seed}:{lang}")
    n_docs = n_docs or max(3, min(500, words // 10_000))
    n_docs = min(n_docs, words)
    # lemma types grow sub-linearly with size (Heaps' law)
    n_lemmas = n_lemmas or max(500, int(5 * words ** 0.62))
    entries, weights = _vocabulary(lang, n_lemmas, rng)
    cum = list(itertools.accumulate(weights))
    base, extra = divmod(words, n_docs)
    for d in range(n_docs):
        n = base + (1 if d < extra else 0)
        tokens, text = _document(entries, cum, n, rng)
        digest = hashlib.sha256(f"{seed}:{lang}:{d}:{text[:200]}".encode()).hexdigest()
        doc_id = conn.execute(
            """INSERT INTO documents (corpus_id,title,source,kind,text,text_hash,n_tokens,pipeline,lang_check,
                                      text_type,doc_date)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (corpus_id, f"Sample document {d + 1}", "", "paste", text, digest, n, "samplegen", "ok",
             ("contract", "manual", "press release")[d % 3], f"20{10 + d % 15}-{1 + d % 12:02d}")).lastrowid
        conn.executemany("INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?,?,?)", ((doc_id, *t) for t in tokens))
    return n_docs
