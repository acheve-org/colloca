"""Document metadata: tags, text type, date, author; and the projects that group corpora."""
import re
import sqlite3
from urllib.parse import urlparse

MAX_TAGS = 20
MAX_TAG_LEN = 40
_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")


class MetadataError(ValueError):
    pass


def normalize_tags(tags: str | list[str] | None) -> list[str]:
    """Lower-cased, trimmed, de-duplicated tags (a comma-separated string or a list)."""
    if not tags:
        return []
    items = tags.split(",") if isinstance(tags, str) else tags
    out: list[str] = []
    for raw in items:
        tag = " ".join(str(raw).split()).lower()
        if not tag:
            continue
        if len(tag) > MAX_TAG_LEN:
            raise MetadataError(f"Tag '{tag[:20]}…' is longer than {MAX_TAG_LEN} characters")
        if tag not in out:
            out.append(tag)
    if len(out) > MAX_TAGS:
        raise MetadataError(f"At most {MAX_TAGS} tags per document")
    return out


def normalize_date(value: str) -> str:
    """'' or YYYY, YYYY-MM, YYYY-MM-DD (a real calendar date)."""
    value = (value or "").strip()
    if not value:
        return ""
    if not _DATE.match(value):
        raise MetadataError("Date must look like 2024, 2024-05 or 2024-05-17")
    parts = [int(p) for p in value.split("-")]
    if len(parts) > 1 and not 1 <= parts[1] <= 12:
        raise MetadataError("Month must be between 01 and 12")
    if len(parts) > 2:
        import calendar
        if not 1 <= parts[2] <= calendar.monthrange(parts[0], parts[1])[1]:
            raise MetadataError(f"{value} is not a valid date")
    return value


def clean_text(value: str, label: str, limit: int = 120) -> str:
    value = " ".join((value or "").split())
    if len(value) > limit:
        raise MetadataError(f"{label} is longer than {limit} characters")
    return value


def clean_meta(text_type: str = "", doc_date: str = "", author: str = "") -> dict:
    return {"text_type": clean_text(text_type, "Text type").lower(), "doc_date": normalize_date(doc_date),
            "author": clean_text(author, "Author")}


def set_tags(conn: sqlite3.Connection, doc_id: int, tags: list[str]) -> None:
    conn.execute("DELETE FROM doc_tags WHERE doc_id=?", (doc_id,))
    conn.executemany("INSERT INTO doc_tags (doc_id, tag) VALUES (?, ?)", ((doc_id, t) for t in tags))


def bulk_update(conn: sqlite3.Connection, ids: list[int], add_tags: list[str], remove_tags: list[str],
                fields: dict[str, str]) -> int:
    """Add and remove tags on, and set the given cleaned fields (text_type, doc_date, author) of, every listed
    document. Raises MetadataError if a document would end up with too many tags; the caller rolls back."""
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.executemany(f"UPDATE documents SET {sets} WHERE id=?", ([*fields.values(), i] for i in ids))
    if add_tags or remove_tags:
        for doc_id in ids:
            current = [r[0] for r in conn.execute("SELECT tag FROM doc_tags WHERE doc_id=? ORDER BY tag", (doc_id,))]
            tags = [t for t in current if t not in remove_tags]
            tags += [t for t in add_tags if t not in tags and t not in remove_tags]
            if len(tags) > MAX_TAGS:
                raise MetadataError(f"At most {MAX_TAGS} tags per document")
            if tags != current:
                set_tags(conn, doc_id, tags)
    return len(ids)


def pad_start(value: str) -> str:
    """First day covered by a (possibly partial) date."""
    return {4: value + "-01-01", 7: value + "-01"}.get(len(value), value)


def pad_end(value: str) -> str:
    """Last day covered by a (possibly partial) date (month ends are padded to 31: dates compare as text)."""
    return {4: value + "-12-31", 7: value + "-31"}.get(len(value), value)


def host_of(source: str, kind: str) -> str:
    """documents.host: the lower-case host name of a URL document (no port), '' for every other kind."""
    return (urlparse(source).hostname or "").lower() if kind == "url" else ""
