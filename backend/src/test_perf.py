"""Performance test to diagnose SSE stream hang."""
import asyncio
import sys
import time

sys.path.insert(0, "backend/src")


async def test_rag_retrieval():
    """Test _retrieve_context performance."""
    from src.services.embedding_service import get_embeddings
    from src.services.vector_store import get_collection_count, search

    UPLOADED_FILES_COLLECTION = "uploaded_files"
    KNOWLEDGE_BASE_COLLECTION = "knowledge_base"

    query = "MDCN_revision_v2.pdf文件讲的是什么"

    # Check collection counts
    uploaded_count = await get_collection_count(UPLOADED_FILES_COLLECTION)
    kb_count = await get_collection_count(KNOWLEDGE_BASE_COLLECTION)
    print(f"uploaded_files docs: {uploaded_count}, kb docs: {kb_count}")

    # List all collections
    from src.services.vector_store import list_collections
    collections = await list_collections()
    for name in collections:
        count = await get_collection_count(name)
        if count > 0:
            print(f"Collection '{name}': {count} docs")

    if uploaded_count == 0 and kb_count == 0:
        return

    # Time embedding generation
    t0 = time.time()
    try:
        embeddings = await get_embeddings([query])
        query_embedding = embeddings[0]
        print(f"Embedding generated in {time.time()-t0:.2f}s")
    except Exception as e:
        print(f"Embedding failed: {e}")
        return

    # Time search
    for collection_name, source_label in [
        (UPLOADED_FILES_COLLECTION, "uploaded_file"),
        (KNOWLEDGE_BASE_COLLECTION, "knowledge_base"),
    ]:
        t0 = time.time()
        try:
            results = await search(collection_name, query, query_embedding, 3)
            print(f"Search '{collection_name}' in {time.time()-t0:.2f}s: {len(results)} results")
            for r in results:
                print(f"  - [{source_label}] content[:100]: {r.content[:100]}")
        except Exception as e:
            print(f"Search '{collection_name}' failed: {e}")


async def test_pdf_parse():
    """Test PDF parsing performance."""
    from pathlib import Path
    from src.services.file_service import parse_file

    t0 = time.time()
    try:
        # Check if the PDF is in uploads
        for f in Path("backend/uploads").glob("*"):
            if f.suffix.lower() == ".pdf":
                print(f"Parsing PDF: {f.name}")
                text = await parse_file(f.name)
                print(f"PDF parsed in {time.time()-t0:.2f}s, length: {len(text)} chars")
                print(f"First 200 chars: {text[:200]}")
                break
        else:
            print("No PDF in uploads, trying paper/ dir...")
            pdf_path = Path("paper/MDCN_revision_v2.pdf")
            if pdf_path.exists():
                # Copy to uploads temporarily
                import shutil
                dest = Path("backend/uploads/MDCN_test.pdf")
                shutil.copy2(pdf_path, dest)
                text = await parse_file("MDCN_test.pdf")
                print(f"PDF parsed in {time.time()-t0:.2f}s, length: {len(text)} chars")
                print(f"First 200 chars: {text[:200]}")

    except Exception as e:
        print(f"PDF parsing failed: {e}")
        import traceback
        traceback.print_exc()


async def test_full_flow():
    """Simulate the full chat flow."""
    from src.services.chat_service import _retrieve_context, _extract_file_text

    # Test RAG context retrieval
    print("\n=== Testing _retrieve_context ===")
    t0 = time.time()
    try:
        rag = await _retrieve_context("MDCN revision v2 document content")
        print(f"RAG context retrieved in {time.time()-t0:.2f}s, length: {len(rag)}")
        if rag:
            print(f"First 300 chars:\n{rag[:300]}")
    except Exception as e:
        print(f"RAG retrieval failed after {time.time()-t0:.2f}s: {e}")
        import traceback
        traceback.print_exc()


async def main():
    print("=" * 50)
    print("1. Testing PDF parsing...")
    await test_pdf_parse()

    print("\n" + "=" * 50)
    print("2. Testing RAG retrieval...")
    await test_rag_retrieval()

    print("\n" + "=" * 50)
    print("3. Testing full flow...")
    await test_full_flow()


if __name__ == "__main__":
    asyncio.run(main())
