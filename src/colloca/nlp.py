"""NLP annotation with spaCy (tokenisation, sentences, lemmas, POS)."""
import os
import threading
from collections.abc import Callable, Iterator

import spacy

from . import languages

SUPPORTED = languages.REGISTRY   # live {code: name} of the registered languages
_SIZES = [os.environ.get("SPACY_SIZE", "md"), "md", "sm", "lg"]
_models: dict[str, spacy.language.Language] = {}
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
        raise RuntimeError(f"No spaCy model installed for '{lang}' (expected {lang}_core_news_*). "
                           "In Docker: docker compose run --rm colloca download-models")


def status() -> dict[str, dict]:
    """The model each language would use, from what is installed (nothing is loaded, so this is fast).

    Per language: package name, version, size (sm|md|lg) and `small`; all None when no model is installed.
    """
    installed = set(spacy.util.get_installed_models())
    out: dict[str, dict] = {}
    for lang in SUPPORTED:
        info: dict = {"name": None, "version": None, "size": None, "small": False}
        for size in dict.fromkeys(_SIZES):
            name = f"{lang}_core_news_{size}"
            if name in installed:
                info = {"name": name, "version": spacy.util.get_package_version(name), "size": size,
                        "small": size == "sm"}
                break
        out[lang] = info
    return out


def pipeline_name(lang: str) -> str:
    nlp = load_model(lang)
    return f"{nlp.meta['lang']}_{nlp.meta['name']} {nlp.meta['version']} (spaCy {spacy.__version__})"


def annotate(text: str, lang: str, progress: Callable[[float], None] | None = None,
             spans: list[tuple[int, int]] | None = None) -> Iterator[tuple]:
    """Yield (pos, sent, form, norm, lemma, upos, alpha, stop, sp) for each token.

    Every non-empty line is processed as its own paragraph, so sentences never span lines.
    `progress`, if given, is called with the fraction of paragraphs done (0..1). `spans`, if given, receives
    one (first token position, end position) pair per line, in line order: the lines of a segmented
    (parallel) document are its segments.
    """
    nlp = load_model(lang)
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    pos = 0
    sent = 0
    for i, doc in enumerate(nlp.pipe(paragraphs, batch_size=32), 1):
        if progress:
            progress(i / len(paragraphs))
        rows = []
        first = pos
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
        if spans is not None:
            spans.append((first, pos))
        yield from map(tuple, rows)
