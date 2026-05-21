import os
import uuid
from pathlib import Path

from fastapi import UploadFile

UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Max 100MB per file
MAX_FILE_SIZE = 100 * 1024 * 1024

SUPPORTED_TYPES = {
    # (extensions, mime types)
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".pdf": {"application/pdf"},
}


def _get_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def _is_supported(filename: str) -> bool:
    ext = _get_extension(filename)
    return ext in SUPPORTED_TYPES


def _validate_file(filename: str, size: int | None, content_type: str | None) -> str | None:
    """Return error message if invalid, None if OK."""
    if size is not None and size > MAX_FILE_SIZE:
        return f"File exceeds 100MB limit"
    if not _is_supported(filename):
        ext = _get_extension(filename)
        return f"Unsupported file type: {ext}"
    return None


async def save_file(file: UploadFile) -> tuple[str, str]:
    """Save uploaded file and return (stored_filename, original_name)."""
    error = _validate_file(file.filename or "file", file.size, file.content_type)
    if error:
        raise ValueError(error)

    # Read content first before opening the output file to avoid empty writes
    content = await file.read()
    if not content:
        raise ValueError("Uploaded file is empty")

    ext = _get_extension(file.filename or "file")
    stored_name = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / stored_name

    path.write_bytes(content)

    return stored_name, file.filename or "file"


async def parse_file(stored_filename: str) -> str:
    """Extract text content from a saved file."""
    path = UPLOAD_DIR / stored_filename
    ext = _get_extension(stored_filename)

    if ext == ".docx":
        return _parse_docx(path)
    elif ext == ".xlsx":
        return _parse_xlsx(path)
    elif ext == ".pdf":
        return _parse_pdf(path)
    else:
        raise ValueError(f"Cannot parse file type: {ext}")


def _parse_docx(path: Path) -> str:
    from docx import Document
    from docx.exceptions import DocxTypeError

    try:
        doc = Document(str(path))
    except (DocxTypeError, ValueError) as e:
        raise ValueError(f"Invalid or corrupted DOCX file: {e}")
    parts: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                parts.append(row_text)
    return "\n".join(parts)


def _parse_xlsx(path: Path) -> str:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    parts: list[str] = []
    for ws in wb.worksheets:
        parts.append(f"=== Sheet: {ws.title} ===")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            row_text = " | ".join(c for c in cells if c)
            if row_text:
                parts.append(row_text)
    wb.close()
    return "\n".join(parts)


def _parse_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            parts.append(text)
    return "\n".join(parts)


async def vectorize_and_store(
    stored_filename: str,
    collection_name: str,
) -> list[str]:
    """Parse, chunk, embed, and store documents in the vector store.

    Returns:
        List of chunk contents that were stored.
    """
    from src.services.embedding_service import get_embeddings
    from src.services.vector_store import add_documents

    from src.utils.chunker import chunk_text

    # Parse file to text
    text = await parse_file(stored_filename)

    # Chunk text
    chunks = chunk_text(text)
    if not chunks:
        return []

    # Generate embeddings
    embeddings = await get_embeddings(chunks)

    # Build metadata list
    metadata_list = [
        {"source": stored_filename, "chunk_index": i, "total_chunks": len(chunks)}
        for i in range(len(chunks))
    ]

    # Store in vector database
    await add_documents(collection_name, chunks, metadata_list)

    return chunks
