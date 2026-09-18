"""File and URL text extraction."""
import csv
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SUPPORTED_EXTS = {".pdf", ".txt", ".md", ".markdown", ".csv", ".docx"}
MAX_FILE_BYTES = 25 * 1024 * 1024


class ExtractError(Exception):
    pass


def extract_file(path: Path, name: str) -> dict:
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(str(path))
        except Exception as e:
            raise ExtractError(f"Could not read PDF ({e.__class__.__name__}). "
                               "The file may be corrupt or password-protected.") from e
        if reader.is_encrypted:
            raise ExtractError("The PDF is password-protected. Remove the password and re-upload.")
        pages = []
        for p in reader.pages:
            try:
                pages.append(p.extract_text() or "")
            except Exception:
                pages.append("")
        text = "\n\n".join(pages)
        if len(text.strip()) < 20:
            raise ExtractError("No readable text found — this PDF appears to be scanned images "
                               "(OCR is not supported yet).")
        return {"text": text, "pages": len(pages), "page_texts": pages}
    if ext == ".docx":
        import docx
        try:
            doc = docx.Document(str(path))
        except Exception as e:
            raise ExtractError("Could not read .docx file. Please save it again and retry.") from e
        parts = []
        for p in doc.paragraphs:
            if not p.text.strip():
                continue
            style = (p.style.name if p.style else "") or ""
            m = re.match(r"Heading\s*(\d)", style)
            if m:
                parts.append("#" * min(int(m.group(1)), 4) + " " + p.text)
            else:
                parts.append(p.text)
        for table in doc.tables:
            rows = [[c.text.strip().replace("\n", " ") for c in row.cells] for row in table.rows]
            if rows:
                parts.append("| " + " | ".join(rows[0]) + " |")
                parts.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
                for row in rows[1:]:
                    parts.append("| " + " | ".join(row) + " |")
        text = "\n".join(parts)
        if len(text.strip()) < 10:
            raise ExtractError("No readable text found in this document.")
        return {"text": text, "pages": None, "page_texts": None}
    if ext in (".txt", ".md", ".markdown"):
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        if len(text.strip()) < 10:
            raise ExtractError("The file appears to be empty.")
        return {"text": text, "pages": None, "page_texts": None}
    if ext == ".csv":
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            rows = list(csv.reader(f))[:400]
        rows = [[c for c in row] for row in rows if any(c.strip() for c in row)]
        if not rows:
            raise ExtractError("The CSV file appears to be empty.")
        header, body = rows[0], rows[1:]
        lines = ["| " + " | ".join(header) + " |",
                 "| " + " | ".join(["---"] * len(header)) + " |"]
        lines += ["| " + " | ".join(r + [""] * (len(header) - len(r))) + " |" for r in body]
        if len(rows) > 400:
            lines.append(f"(first 400 of {len(rows)} rows indexed)")
        return {"text": "\n".join(lines), "pages": None, "page_texts": None}
    if ext == ".doc":
        raise ExtractError("Legacy .doc files are not supported. Open it in Word/Docs and "
                           "re-save as .docx, then upload again.")
    raise ExtractError(f"Unsupported file type '{ext or 'unknown'}'. "
                       "Supported: PDF, TXT, MD, DOCX, CSV.")


def extract_url(url: str, timeout: int = 20) -> dict:
    if not re.match(r"^https?://", url):
        url = "https://" + url
    try:
        r = requests.get(url, timeout=timeout,
                         headers={"User-Agent": "Mozilla/5.0 (compatible; PreciousAI/1.0)"})
    except requests.RequestException as e:
        raise ExtractError(f"Could not reach that URL ({e.__class__.__name__}). "
                           "Check the address and try again.") from e
    if r.status_code >= 400:
        raise ExtractError(f"The site returned HTTP {r.status_code}.")
    soup = BeautifulSoup(r.content, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else url
    text = re.sub(r"\n{3,}", "\n\n", soup.get_text("\n").strip())
    text = re.sub(r"[ \t]{2,}", " ", text)
    if len(text) < 50:
        raise ExtractError("The page has no extractable text (it may be a JavaScript-only app).")
    return {"text": text, "pages": None, "page_texts": None, "title": title[:120]}
