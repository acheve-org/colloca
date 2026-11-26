"""NLP annotation with spaCy (tokenisation, sentences, lemmas, POS)."""
import importlib.metadata
import os
import threading
from collections.abc import Callable, Iterator

import spacy

from . import langcatalog, languages

SUPPORTED = languages.REGISTRY   # live {code: name} of the registered languages
_models: dict[str, spacy.language.Language] = {}
_lock = threading.Lock()


def size_order(lang: str) -> list[str]:
    """Model sizes to try for a language: its own setting, then SPACY_SIZE, then any other."""
    own = languages.get(lang)
    return list(dict.fromkeys([s for s in (own.model_size if own else None, os.environ.get("SPACY_SIZE", "lg"),
                                           "md", "sm", "lg") if s]))


def installed_version(package: str) -> str | None:
    """Version of an installed model package, read from the live environment (spaCy's own list is cached, so it
    misses a model installed while the app runs)."""
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def evict(lang: str) -> None:
    """Forget the loaded model of a language (its size changed or it was uninstalled)."""
    with _lock:
        _models.pop(lang, None)


def load_model(lang: str):
    if lang not in SUPPORTED:
        raise ValueError(f"Unsupported language '{lang}'. Supported: {', '.join(SUPPORTED)}")
    with _lock:
        if lang in _models:
            return _models[lang]
        for size in size_order(lang):
            name = langcatalog.package(lang, size) if lang in langcatalog.CATALOG else f"{lang}_core_news_{size}"
            try:
                nlp = spacy.load(name, exclude=["ner"])
                nlp.max_length = 2_000_000
                _models[lang] = nlp
                return nlp
            except OSError:
                continue
        raise RuntimeError(f"No spaCy model installed for '{lang}' (expected {lang}_core_news_*). "
                           "Install it in the Languages screen.")


def status() -> dict[str, dict]:
    """The model each language would use, from what is installed (nothing is loaded, so this is fast).

    Per language: package name, version, size (sm|md|lg) and `small`; all None when no model is installed.
    """
    out: dict[str, dict] = {}
    for lang in SUPPORTED:
        info: dict = {"name": None, "version": None, "size": None, "small": False}
        for size in size_order(lang):
            name = langcatalog.package(lang, size) if lang in langcatalog.CATALOG else f"{lang}_core_news_{size}"
            version = installed_version(name)
            if version:
                info = {"name": name, "version": version, "size": size, "small": size == "sm"}
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
