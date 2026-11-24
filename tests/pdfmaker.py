"""Hand-made PDFs for tests: text placed at exact positions, so layouts (columns, tables) are known."""
import io


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[list[tuple[float, float, str]]], width: int = 600, height: int = 800, size: int = 11) -> bytes:
    """`pages` is a list of pages, each a list of (x, y, text) runs (y counts from the bottom). Helvetica, one run
    per Tj, so a run is what the extractor sees as a fragment."""
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    add(b"")                                    # 1: catalog (filled below)
    add(b"")                                    # 2: pages
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    kids = []
    for runs in pages:
        stream = "\n".join(f"BT /F1 {size} Tf {x} {y} Td ({_esc(t)}) Tj ET" for x, y, t in runs).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(add(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
                        f"/Contents {content} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>".encode()))
    objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def lines(x: float, top: float, texts: list[str], step: float = 14) -> list[tuple[float, float, str]]:
    """Consecutive lines starting at height `top`, all at the same x."""
    return [(x, top - i * step, t) for i, t in enumerate(texts)]
