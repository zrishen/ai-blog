"""Debug: check what's actually stored in ChromaDB and test search."""
import asyncio
import sys

import chromadb

# Same config as the app
import os
os.chdir("c:/programs/ai_assistant/backend")
sys.path.insert(0, "c:/programs/ai_assistant/backend")

from src.core.config import settings
from src.services.embedding_service import get_embeddings


async def main():
    # 1. Check what's in ChromaDB
    client = chromadb.PersistentClient(path=settings.chroma_db_path)
    collections = client.list_collections()

    print("=== ChromaDB Collections ===")
    for c in collections:
        print(f"  {c.name}: {c.count()} docs")

    # 2. Peek at actual stored content in test_upload
    print("\n=== test_upload stored content ===")
    try:
        col = client.get_collection("test_upload")
        results = col.get(include=["documents", "metadatas"])
        for i in range(len(results["ids"])):
            doc_preview = results["documents"][i][:200] if results["documents"][i] else "(empty)"
            meta = results["metadatas"][i] if results["metadatas"] else {}
            print(f"  Doc {i}: '{doc_preview}'")
            print(f"    Meta: {meta}")
    except Exception as e:
        print(f"  Error: {e}")

    # 3. Test embedding + search
    print("\n=== Search Test ===")
    queries = [
        "test_upload.docx里写了什么",
        "test_upload.docx文件内容",
        "test_upload",
    ]
    for query in queries:
        print(f"\nQuery: '{query}'")
        embeddings = await get_embeddings([query])
        q_emb = embeddings[0]
        print(f"  Embedding dim: {len(q_emb)}, all float: {all(isinstance(x, float) for x in q_emb)}")

        for name in collections:
            if name.count > 0:
                try:
                    col = client.get_collection(name.name)
                    n = min(3, col.count())
                    res = col.query(
                        query_embeddings=[q_emb],
                        n_results=n,
                        include=["documents", "metadatas", "distances"],
                    )
                    if res["ids"][0]:
                        print(f"  [{name.name}] Found {len(res['ids'][0])} results:")
                        for j in range(len(res["ids"][0])):
                            dist = res["distances"][0][j] if res["distances"] else "?"
                            doc = (res["documents"][0][j][:150] + "...") if len(res["documents"][0][j]) > 150 else res["documents"][0][j]
                            print(f"    #{j+1} dist={dist:.4f}: {doc}")
                    else:
                        print(f"  [{name.name}] No results")
                except Exception as e:
                    print(f"  [{name.name}] Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
