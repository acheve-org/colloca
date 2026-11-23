"""NLP annotation with spaCy (tokenisation, sentences, lemmas, POS)."""
import os
import threading
from typing import Iterator

import spacy

SUPPORTED = {"es": "Spanish", "it": "Italian"}
_SIZES = [os.environ.get("SPACY_SIZE", "md"), "md", "sm", "lg"]
_models: dict[str, "spacy.language.Language"] = {}
_lock = threading.Lock()


def load_model(lang: str):
    if lang not in SUPPORTED:
        raise ValueError(f"Unsupported language '{lang}'. Supported: {', '.join(SUPPORTED)}")
    with _lock:
        if lang in _models:
            return _models[lang]
        for size in dict.fromkeys(_SIZES):
            name = f"{lang}_core_news_{size}"
            try:
                nlp = spacy.load(name, exclude=["ner"])
                nlp.max_length = 2_000_000
                _models[lang] = nlp
                return nlp
            except OSError:
                continue
        raise RuntimeError(f"No spaCy model installed for '{lang}' (expected {lang}_core_news_*)")


def pipeline_name(lang: str) -> str:
    nlp = load_model(lang)
    return f"{nlp.meta['lang']}_{nlp.meta['name']} {nlp.meta['version']} (spaCy {spacy.__version__})"


def annotate(text: str, lang: str) -> Iterator[tuple]:
    """Yield (pos, sent, form, norm, lemma, upos, alpha, stop, sp) for each token.

    Every non-empty line is processed as its own paragraph, so sentences never span lines.
    """
    nlp = load_model(lang)
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    pos = 0
    sent = 0
    for doc in nlp.pipe(paragraphs, batch_size=32):
        rows = []
        for s in doc.sents:
            emitted = False
            for tok in s:
                if tok.is_space:
                    continue
                emitted = True
                rows.append([
                    pos, sent, tok.text, tok.text.lower(),
                    (tok.lemma_ or tok.text).lower(), tok.pos_,
                    int(tok.is_alpha), int(tok.is_stop), int(bool(tok.whitespace_)),
                ])
                pos += 1
            if emitted:
                sent += 1
        if rows:
            rows[-1][-1] = 1  # a paragraph break reads as a space in concordance lines
        yield from map(tuple, rows)
