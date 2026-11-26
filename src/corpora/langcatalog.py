"""The languages that can be added: spaCy's official trained pipelines (3.8) and their Tesseract codes.

This table is the only source of package names and download URLs, so nothing a user types ever reaches a command
line. Left out on purpose: ja, ko, zh (not space-delimited), xx (no lemmas), ru and uk (their lemmatizers need the
extra package pymorphy3).
"""
from dataclasses import dataclass

MODEL_VERSION = "3.8.0"          # matches the spaCy range pinned in pyproject.toml (>=3.7,<3.9)
SIZES = ("sm", "md", "lg")


@dataclass(frozen=True)
class Entry:
    code: str
    name: str
    stem: str
    sizes: tuple[str, ...]
    tesseract: str


def _e(code: str, name: str, tesseract: str, stem: str | None = None) -> Entry:
    return Entry(code, name, stem or f"{code}_core_news", SIZES, tesseract)


CATALOG: dict[str, Entry] = {e.code: e for e in (
    _e("ca", "Catalan", "cat"), _e("da", "Danish", "dan"), _e("de", "German", "deu"), _e("el", "Greek", "ell"),
    _e("en", "English", "eng", "en_core_web"), _e("es", "Spanish", "spa"), _e("fi", "Finnish", "fin"),
    _e("fr", "French", "fra"), _e("hr", "Croatian", "hrv"), _e("it", "Italian", "ita"),
    _e("lt", "Lithuanian", "lit"), _e("mk", "Macedonian", "mkd"), _e("nb", "Norwegian Bokmål", "nor"),
    _e("nl", "Dutch", "nld"), _e("pl", "Polish", "pol"), _e("pt", "Portuguese", "por"),
    _e("ro", "Romanian", "ron"), _e("sl", "Slovenian", "slv"), _e("sv", "Swedish", "swe"),
)}


def package(code: str, size: str) -> str:
    entry = CATALOG.get(code)
    if entry is None:
        raise ValueError(f"Unknown language '{code}'")
    if size not in entry.sizes:
        raise ValueError(f"No '{size}' model for {entry.name}")
    return f"{entry.stem}_{size}"


def wheel_url(code: str, size: str) -> str:
    pkg = package(code, size)
    return (f"https://github.com/explosion/spacy-models/releases/download/{pkg}-{MODEL_VERSION}/"
            f"{pkg}-{MODEL_VERSION}-py3-none-any.whl")


def tessdata_url(tesseract: str) -> str:
    if tesseract not in {e.tesseract for e in CATALOG.values()}:
        raise ValueError(f"Unknown OCR language '{tesseract}'")
    return f"https://github.com/tesseract-ocr/tessdata_fast/raw/main/{tesseract}.traineddata"
