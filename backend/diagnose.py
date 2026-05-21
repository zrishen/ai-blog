"""Performance test to diagnose SSE stream hang."""
import asyncio
import sys
import time
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from src.services.embedding_service import get_embeddings
from src.services.file_service import parse_file
from src.services.vector_store import get_collection_count, search, list_collections


async def test_pdf_parse():
    """Test PDF parsing performance."""
    t0 = time.time()
    try:
        for f in Path("uploads").glob("*"):
            if f.suffix.lower() == ".pdf":
                print(f"Parsing PDF: {f.name}")
                text = await parse_file(f.name)
                print(f"PDF parsed in {time.time()-t0:.2f}s, length: {len(text)} chars")
                print(f"First 200 chars: {text[:200]}")
                return text
        else:
            print("No PDF in uploads")
            return None
    except Exception as e:
        print(f"PDF parsing failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def test_rag_retrieval(query: str):
    """Test RAG retrieval performance."""
    UPLOADED_FILES_COLLECTION = "uploaded_files"
    KNOWLEDGE_BASE_COLLECTION = "knowledge_base"

    # Check collection counts
    uploaded_count = await get_collection_count(UPLOADED_FILES_COLLECTION)
    kb_count = await get_collection_count(KNOWLEDGE_BASE_COLLECTION)
    print(f"uploaded_files docs: {uploaded_count}, kb docs: {kb_count}")

    # List all collections
    collections = await list_collections()
    for name in collections:
        count = await get_collection_count(name)
        if count > 0:
            print(f"Collection '{name}': {count} docs")

    if uploaded_count == 0 and kb_count == 0:
        print("No collections found - RAG will return empty context")
        return ""

    # Time embedding generation
    t0 = time.time()
    try:
        embeddings = await get_embeddings([query])
        query_embedding = embeddings[0]
        print(f"Embedding generated in {time.time()-t0:.2f}s")
    except Exception as e:
        print(f"Embedding failed: {e}")
        return ""

    # Time search
    all_results = []
    for collection_name, source_label in [
        (UPLOADED_FILES_COLLECTION, "uploaded_file"),
        (KNOWLEDGE_BASE_COLLECTION, "knowledge_base"),
    ]:
        t0 = time.time()
        try:
            results = await search(collection_name, query, query_embedding, 3)
            print(f"Search '{collection_name}' in {time.time()-t0:.2f}s: {len(results)} results")
            for r in results:
                meta = r.metadata or {}
                all_results.append((
                    f"[{source_label}:{meta.get('source', 'unknown')}]",
                    r.content,
                    r.distance,
                ))
        except Exception as e:
            print(f"Search '{collection_name}' failed: {e}")

    if not all_results:
        return ""

    # Format context
    context_parts = []
    for source, content, _ in all_results:
        context_parts.append(f"{source}\n{content}")

    return "[检索到的参考内容]\n" + "\n---\n".join(context_parts) + "\n---\n"


async def test_retrieve_context(query: str):
    """Test the _retrieve_context function."""
    # Import the actual function
    import importlib
    mod = importlib.import_module("src.services.chat_service")
    func = mod._retrieve_context
    t0 = time.time()
    result = await func(query)
    print(f"_retrieve_context in {time.time()-t0:.2f}s, length: {len(result)}")
    return result


async def main():
    print("=" * 60)
    print("1. Testing PDF parsing...")
    await test_pdf_parse()

    print("\n" + "=" * 60)
    print("2. Testing RAG retrieval...")
    query = "MDCN revision v2 pdf document content"
    rag = await test_rag_retrieval(query)
    if rag:
        print(f"\nRAG result:\n{rag}")
    else:
        print("\nNo RAG context found!")

    print("\n" + "=" * 60)
    print("3. Testing _retrieve_context function...")
    rag2 = await test_retrieve_context(query)
    if rag2:
        print(f"Context:\n{rag2[:500]}")


if __name__ == "__main__":
    asyncio.run(main())
