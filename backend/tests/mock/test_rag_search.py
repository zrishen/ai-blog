from src.tools.agent_tools import _filter_and_dedupe_rag_results, _format_rag_context
from src.services.vector_store import SearchResult


def test_rag_filter_dedupe_and_format():
    duplicate = "安装步骤：先运行 uv sync，再启动 uvicorn。"
    results = [
        ("doc_a", SearchResult(content=duplicate, metadata={"source": "a.pdf"}, distance=0.2)),
        ("doc_b", SearchResult(content=duplicate, metadata={"source": "b.pdf"}, distance=0.3)),
        ("doc_c", SearchResult(content="无关内容", metadata={"source": "c.pdf"}, distance=0.95)),
        ("doc_d", SearchResult(content="配置 MCP 工具需要填写 command 和 args。", metadata={"source": "d.pdf"}, distance=0.1)),
    ]

    filtered = _filter_and_dedupe_rag_results(results)
    context = _format_rag_context(filtered)

    assert len(filtered) == 2
    assert filtered[0][0] == "doc_d"
    assert "[检索到的参考内容]" in context
    assert "[来源 1]" in context
    assert "知识库：doc_d" in context
    assert "来源：d.pdf" in context
    assert context.count(duplicate) == 1
    assert "无关内容" not in context


def test_rag_empty_context_prevents_fabrication():
    context = _format_rag_context([])

    assert "没有找到与用户问题相关的知识库内容" in context
    assert "不要编造" in context
