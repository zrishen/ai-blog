"""Quick test: query the vector store and print search results."""
import asyncio
import sys

sys.path.insert(0, "c:/programs/ai_assistant/backend")

from src.services.embedding_service import get_embeddings
from src.services.vector_store import search, list_collections, get_collection_count


async def main():
    query = "test_upload.docx文件内容"
    print(f"Query: {query}")

    # Get embedding
    embeddings = await get_embeddings([query])
    q_emb = embeddings[0]
    print(f"Embedding dim: {len(q_emb)}")
    print(f"All float: {all(isinstance(x, float) for x in q_emb)}")

    # List collections
    names = await list_collections()
    print(f"Collections: {names}")

    for name in names:
        count = await get_collection_count(name)
        if count > 0:
            print(f"\nCollection: {name} ({count} docs)")
            try:
                results = await search(name, query, q_emb, top_k=3)
                if results:
                    for i, r in enumerate(results, 1):
                        dist = r.distance
                        preview = (r.content[:200] + "...") if len(r.content) > 200 else r.content
                        print(f"  Result {i}: dist={dist:.4f}")
                        print(f"    Content: {preview}")
                        meta = r.metadata or {}
                        if meta:
                            print(f"    Meta: {meta}")
                else:
                    print("  No results returned")
            except Exception as e:
                print(f"  Error: {e}")
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
