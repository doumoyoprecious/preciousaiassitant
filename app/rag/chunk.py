"""Text chunking with heading (section) tracking."""
import re

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def _stream_chunks(lines, target, overlap, start_page=None):
    chunks = []
    section = ""
    buf = ""

    def flush():
        nonlocal buf
        content = re.sub(r"\n{2,}", "\n", buf).strip()
        if len(content) >= 40:
            chunks.append({"content": content, "page": start_page, "section": section or None})
        buf = ""

    for line in lines:
        m = HEADING_RE.match(line.strip())
        if m:
            if len(buf) > target:
                flush()
            section = m.group(2).strip()[:120]
            buf += line + "\n"
            continue
        if buf and len(buf) + len(line) > target:
            flush()
            tail = buf[-overlap:] if len(buf) > overlap else ""
            buf = tail + line + "\n"
        else:
            buf += line + "\n"
    flush()
    return chunks


def chunk_text(text: str, target: int = 700, overlap: int = 100, start_page: int = None):
    lines = text.splitlines()
    chunks = _stream_chunks(lines, target, overlap, start_page)
    if not chunks and text.strip():
        chunks.append({"content": text.strip()[: target * 2], "page": start_page, "section": None})
    return chunks


def chunk_document(text: str, page_texts, target: int = 700, overlap: int = 100):
    """Chunk a document; if per-page text is available (PDF), track page numbers."""
    if page_texts:
        out = []
        for i, page_text in enumerate(page_texts, start=1):
            if page_text.strip():
                out.extend(chunk_text(page_text, target, overlap, start_page=i))
        return out or [{"content": text.strip()[: target * 2], "page": None, "section": None}]
    return chunk_text(text, target, overlap)
