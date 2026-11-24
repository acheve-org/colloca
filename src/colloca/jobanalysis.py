"""Analyse a text you are about to translate against a client corpus and its termbase.

The report answers, before the first segment is translated:
  * how much of the text's vocabulary the corpus has evidence for (coverage) and where it has none (gaps);
  * which words are characteristic of the text compared with general language (key terms);
  * which termbase entries occur in it, and the translations to use or avoid;
  * which phrases the text repeats, and whether the corpus already uses them.
The text itself is analysed and forgotten: nothing is added to any corpus.
"""
import math
from collections import Counter, defaultdict

from . import analysis, importer, ingest, langcheck, nlp

MAX_PHRASES = 25
PHRASE_LENGTHS = (4, 3, 2)


def _terms_in_scope(conn, corpus) -> list[dict]:
    """Termbase entries (of the corpus's project and language), each with the token forms and lemmas of its
    source term, produced by the same tokenizer and lemmatizer as the text, so inflected entries match."""
    where = "t.project_id IS NULL" if corpus["project_id"] is None else "t.project_id=?"
    params = [] if corpus["project_id"] is None else [corpus["project_id"]]
    rows = [dict(r) for r in conn.execute(f"SELECT t.* FROM terms t WHERE {where} AND t.src_lang=? ORDER BY t.id",
                                          [*params, corpus["lang"]])]
    rows = [r for r in rows if r["src_term"].split()]
    if not rows:
        return []
    spans: list[tuple[int, int]] = []
    toks = list(nlp.annotate("\n".join(" ".join(r["src_term"].split()) for r in rows), corpus["lang"], None, spans))
    for r, (a, b) in zip(rows, spans, strict=True):
        r["norms"] = tuple(t[3] for t in toks[a:b])
        r["lemmas"] = tuple(t[4] for t in toks[a:b])
    return rows


def _match_terms(tokens: list[tuple], sentences: dict[int, str], entries: list[dict]) -> list[dict]:
    """Termbase entries found in the text, by exact word forms or by lemmas, grouped per source term, with
    the number of occurrences and the first sentence where the term occurs."""
    index: dict[tuple, set[str]] = defaultdict(set)         # token tuple -> source terms having it
    by_term: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        key = e["src_term"].lower()
        by_term[key].append(e)
        index[e["norms"]].add(key)
        index[e["lemmas"]].add(key)
    norms = [t[3] for t in tokens]
    lemmas = [t[4] for t in tokens]
    found: dict[str, dict] = {}
    for n in sorted({len(k) for k in index}):
        for i in range(len(tokens) - n + 1):
            hits = index.get(tuple(norms[i:i + n]), set()) | index.get(tuple(lemmas[i:i + n]), set())
            for key in hits:
                hit = found.setdefault(key, {"count": 0, "example": sentences.get(tokens[i][1], "")})
                hit["count"] += 1
    rows = []
    for key, hit in found.items():
        group = by_term[key]
        rows.append({
            "item": group[0]["src_term"], "occurrences": hit["count"], "example": hit["example"],
            "translations": [{"id": e["id"], "term": e["tgt_term"], "status": e["status"]} for e in group],
            "ids": [e["id"] for e in group],
        })
    rows.sort(key=lambda r: (-r["occurrences"], r["item"].lower()))
    return rows


def _sentences(tokens: list[tuple]) -> dict[int, str]:
    """Sentence index -> text (only the sentences that are needed are built by the caller's lookups)."""
    parts: dict[int, list[str]] = defaultdict(list)
    for t in tokens:
        parts[t[1]].append(t[2] + (" " if t[8] else ""))
    return {i: "".join(p).strip() for i, p in parts.items()}


def _phrases(conn, scope, tokens: list[tuple], sentences: dict[int, str]) -> list[dict]:
    """Phrases (2-4 words, no stopword at either edge) that the text repeats, with their corpus frequency."""
    counts: Counter = Counter()
    by_sentence: dict[int, list[tuple]] = defaultdict(list)
    for t in tokens:
        by_sentence[t[1]].append(t)
    for sent in by_sentence.values():
        for n in PHRASE_LENGTHS:
            for i in range(len(sent) - n + 1):
                win = sent[i:i + n]
                if all(t[6] for t in win) and not win[0][7] and not win[-1][7]:
                    counts[tuple(t[3] for t in win)] += 1
    repeated = [(k, c) for k, c in counts.items() if c >= 2]
    # a phrase contained in a longer phrase with the same count is redundant
    keep = [(k, c) for k, c in repeated
            if not any(len(k2) > len(k) and c2 == c and _contains(k2, k) for k2, c2 in repeated)]
    keep.sort(key=lambda kc: (-kc[1] * len(kc[0]), kc[0]))
    rows = []
    for words, freq in keep[:MAX_PHRASES]:
        hits = analysis._find_hits(conn, scope, list(words), "norm")
        rows.append({"item": " ".join(words), "job_freq": freq, "corpus_freq": len(hits),
                     "words": len(words)})
    return rows


def _contains(longer: tuple, shorter: tuple) -> bool:
    n = len(shorter)
    return any(longer[i:i + n] == shorter for i in range(len(longer) - n + 1))


def analyse(conn, scope, corpus, text: str, *, min_freq: int = 2, min_corpus_freq: int = 3, limit: int = 200,
            force_language: bool = False, progress=None) -> dict:
    scope = analysis.as_scope(scope)
    text = ingest.normalize_text(text)
    if len(text) < importer.MIN_CHARS:
        raise importer.ImportRejected(400, "The text is too short to analyse")
    if len(text) > ingest.MAX_TEXT_CHARS:
        raise importer.ImportRejected(413, "The text is too large to analyse", "too_large")
    lang = corpus["lang"]
    check = langcheck.check(text, lang)
    if check["verdict"] == "mismatch" and not force_language:
        raise importer.ImportRejected(
            422, f"This text looks {nlp.SUPPORTED[check['detected']]}, but the corpus is {nlp.SUPPORTED[lang]}. "
                 "Tick “analyse even if the language looks wrong” to continue.", "language_mismatch")

    tokens = list(nlp.annotate(text, lang, lambda f: progress(0.8 * f) if progress else None))
    if progress:
        progress(0.85)
    sentences = _sentences(tokens)
    words = sum(t[6] for t in tokens)
    content = [t for t in tokens if t[6] and not t[7]]
    job_freq = Counter(t[4] for t in content)
    pos_of: dict[str, Counter] = defaultdict(Counter)
    for t in content:
        pos_of[t[4]][t[5]] += 1

    lemmas = list(job_freq)
    corpus_freq = analysis.counts_for(conn, scope, "lemma", lemmas)
    corpus_size = analysis.corpus_size(conn, scope)
    terms = _terms_in_scope(conn, corpus)
    single = defaultdict(list)                       # lemma -> termbase entries, for the tables below
    for e in terms:
        for form in {e["lemmas"], e["norms"]}:
            if len(form) == 1:
                single[form[0]].append(e)

    def tb(lemma: str) -> str:
        entries = single.get(lemma, [])
        for wanted in ("approved", "admitted"):          # the preferred translation first, then an acceptable one
            found = next((e["tgt_term"] for e in entries if e["status"] == wanted and e["tgt_term"]), "")
            if found:
                return found
        return "(candidate)" if entries else ""

    well = sum(c for lemma, c in job_freq.items() if corpus_freq[lemma] >= min_corpus_freq)
    seen = sum(c for lemma, c in job_freq.items() if corpus_freq[lemma] > 0)
    types_well = sum(1 for lemma in job_freq if corpus_freq[lemma] >= min_corpus_freq)
    n_content = len(content)

    gaps = [{"item": lemma, "pos": pos_of[lemma].most_common(1)[0][0], "job_freq": c,
             "corpus_freq": corpus_freq[lemma], "termbase": tb(lemma)}
            for lemma, c in job_freq.items() if corpus_freq[lemma] < min_corpus_freq]
    gaps.sort(key=lambda r: (r["corpus_freq"], -r["job_freq"], r["item"]))

    ref = analysis.reference_corpus(conn, lang)
    ref_id = ref["id"] if ref and analysis.corpus_size(conn, ref["id"]) > 0 else None
    key_terms: list[dict] = []
    if ref_id:
        ref_counts = analysis.counts_for(conn, ref_id, "lemma", lemmas)
        ref_size = max(analysis.corpus_size(conn, ref_id), 1)
        for lemma, a in job_freq.items():
            if a < min_freq:
                continue
            b = ref_counts[lemma]
            if a / max(words, 1) <= b / ref_size:
                continue                              # not over-represented in this text
            key_terms.append({
                "item": lemma, "pos": pos_of[lemma].most_common(1)[0][0], "job_freq": a,
                "corpus_freq": corpus_freq[lemma], "base_per_million": round(b * 1e6 / ref_size, 1),
                "log_ratio": round(math.log2((a / max(words, 1)) / ((b or 0.5) / ref_size)), 2),
                "ll": round(analysis.keyness_ll(a, b, max(words, 1), ref_size), 1), "termbase": tb(lemma)})
        key_terms.sort(key=lambda r: -r["ll"])
    else:
        key_terms = [{"item": lemma, "pos": pos_of[lemma].most_common(1)[0][0], "job_freq": a,
                      "corpus_freq": corpus_freq[lemma], "base_per_million": None, "log_ratio": None, "ll": None,
                      "termbase": tb(lemma)}
                     for lemma, a in job_freq.most_common() if a >= min_freq]
    if progress:
        progress(0.92)

    known = _match_terms(tokens, sentences, terms)
    phrases = _phrases(conn, scope, tokens, sentences)
    if progress:
        progress(1.0)
    return {
        "summary": {
            "words": words, "content_words": n_content, "distinct_lemmas": len(job_freq),
            "sentences": len(sentences), "language_check": check["verdict"],
            "corpus_words": corpus_size, "corpus_filtered": scope.filtered,
            "min_corpus_freq": min_corpus_freq, "min_job_freq": min_freq,
            "coverage_tokens_pct": round(100 * well / n_content, 1) if n_content else 0.0,
            "coverage_seen_pct": round(100 * seen / n_content, 1) if n_content else 0.0,
            "coverage_types_pct": round(100 * types_well / len(job_freq), 1) if job_freq else 0.0,
            "uncovered_types": len(gaps), "termbase_terms_found": len(known),
            "termbase_size": len(terms),
            "reference": "base" if ref_id else None,
        },
        "key_terms": key_terms[:limit], "gaps": gaps[:limit], "known_terms": known[:limit],
        "phrases": phrases,
    }
