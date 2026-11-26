"""The registry of languages the user works with (table `languages`)."""
from collections.abc import Iterator, Mapping
from dataclasses import dataclass

from . import db


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


UNSET = _Unset()


@dataclass(frozen=True)
class Language:
    code: str
    name: str
    model_size: str | None     # None: follow SPACY_SIZE
    tesseract: str             # OCR language code, '' = none


class LanguageInUse(Exception):
    def __init__(self, count: int):
        super().__init__(f"{count} corpora use this language")
        self.count = count


_ready = False


def _session():
    """A db session; the schema is brought up to date once per process, so library users (the CLI, tests that
    never start the app) can read the registry without the web app having initialised the database."""
    global _ready
    if not _ready:
        db.init_db()
        _ready = True
    return db.session()


def _row(r) -> Language:
    return Language(r["code"], r["name"], r["model_size"], r["tesseract"])


_cache: list[Language] | None = None     # the registry is read often (every validation), changed rarely


def _invalidate() -> None:
    global _cache
    _cache = None


def all_languages() -> list[Language]:
    global _cache
    if _cache is None:
        with _session() as conn:
            _cache = [_row(r) for r in conn.execute("SELECT * FROM languages ORDER BY added, code")]
    return list(_cache)


def get(code: str) -> Language | None:
    return next((lang for lang in all_languages() if lang.code == code), None)


def add(code: str, name: str, model_size: str | None, tesseract: str) -> Language:
    with _session() as conn:
        if conn.execute("SELECT 1 FROM languages WHERE code=?", (code,)).fetchone():
            raise ValueError(f"Language '{code}' is already set up")
        conn.execute("INSERT INTO languages (code,name,model_size,tesseract) VALUES (?,?,?,?)",
                     (code, name, model_size, tesseract))
    _invalidate()
    return Language(code, name, model_size, tesseract)


def update(code: str, *, name: str | None = None, model_size: "str | None | _Unset" = UNSET,
           tesseract: str | None = None) -> Language:
    with _session() as conn:
        if not conn.execute("SELECT 1 FROM languages WHERE code=?", (code,)).fetchone():
            raise KeyError(code)
        if name is not None:
            conn.execute("UPDATE languages SET name=? WHERE code=?", (name, code))
        if not isinstance(model_size, _Unset):
            conn.execute("UPDATE languages SET model_size=? WHERE code=?", (model_size, code))
        if tesseract is not None:
            conn.execute("UPDATE languages SET tesseract=? WHERE code=?", (tesseract, code))
    _invalidate()
    updated = get(code)
    assert updated is not None      # it existed above and nothing removes it in between
    return updated


def corpus_count(code: str) -> int:
    """Your own corpora in this language, trashed ones included (a restore would orphan them). The language's
    base corpus is not counted, live or trashed (`was_reference`): it goes with the language (see `remove`)."""
    with _session() as conn:
        return conn.execute("SELECT COUNT(*) FROM corpora WHERE lang=? AND is_reference=0 AND was_reference=0",
                            (code,)).fetchone()[0]


def remove(code: str) -> None:
    """Remove a language no corpus of yours uses; its base corpus (live or trashed) is deleted for good with it."""
    n = corpus_count(code)
    if n:
        raise LanguageInUse(n)
    with _session() as conn:
        gone = conn.execute("DELETE FROM languages WHERE code=?", (code,)).rowcount
        if gone:
            conn.execute("DELETE FROM corpora WHERE lang=?", (code,))   # only base corpora are left
    _invalidate()
    if gone == 0:
        raise KeyError(code)


class _Registry(Mapping):
    """`{code: name}` read from the database on every access."""

    def _all(self) -> dict[str, str]:
        return {lang.code: lang.name for lang in all_languages()}

    def __getitem__(self, code: str) -> str:
        lang = get(code)
        if lang is None:
            raise KeyError(code)
        return lang.name

    def __iter__(self) -> Iterator[str]:
        return iter(self._all())

    def __len__(self) -> int:
        return len(self._all())

    def __contains__(self, code: object) -> bool:
        return isinstance(code, str) and get(code) is not None


REGISTRY = _Registry()
