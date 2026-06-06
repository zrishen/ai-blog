"""Document chunking utility for RAG."""

from langchain_text_splitters import RecursiveCharacterTextSplitter

_CHINESE_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", ". ", " ", ""]
_DEFAULT_CHUNK_SIZE = 500
_DEFAULT_OVERLAP = 100

_splitter = RecursiveCharacterTextSplitter(
    separators=_CHINESE_SEPARATORS,
    chunk_size=_DEFAULT_CHUNK_SIZE,
    chunk_overlap=_DEFAULT_OVERLAP,
    length_function=len,
    keep_separator="end",
)


def chunk_text(text: str, chunk_size: int = _DEFAULT_CHUNK_SIZE, overlap: int = _DEFAULT_OVERLAP) -> list[str]:
    """Split text into overlapping chunks."""
    if not text or not text.strip():
        return []

    if chunk_size == _DEFAULT_CHUNK_SIZE and overlap == _DEFAULT_OVERLAP:
        return _splitter.split_text(text)

    splitter = RecursiveCharacterTextSplitter(
        separators=_CHINESE_SEPARATORS,
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        length_function=len,
    )
    return splitter.split_text(text)
