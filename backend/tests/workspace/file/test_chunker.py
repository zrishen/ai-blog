from src.utils.chunker import chunk_text
from src.utils.file_parser import _clean_pdf_text


def test_chunk_text_empty_returns_empty_list():
    assert chunk_text("") == []
    assert chunk_text("   ") == []
    assert chunk_text("\n\n") == []


def test_chunk_text_short_text_not_split():
    text = "这是一段短文本。"
    assert chunk_text(text) == [text]


def test_chunk_text_splits_on_chinese_sentence_boundary():
    text = "这是第一句话。" * 80
    chunks = chunk_text(text)

    assert len(chunks) > 1
    assert all(chunk.endswith("。") for chunk in chunks[:-1])


def test_chunk_text_splits_on_chinese_exclamation_boundary():
    text = "注意安全！" * 160
    chunks = chunk_text(text)

    assert len(chunks) > 1
    assert all(chunk.endswith("！") for chunk in chunks[:-1])


def test_chunk_text_splits_on_chinese_question_boundary():
    text = "你是谁？" * 220
    chunks = chunk_text(text)

    assert len(chunks) > 1
    assert all(chunk.endswith("？") for chunk in chunks[:-1])


def test_chunk_text_hard_splits_text_without_separators():
    chunks = chunk_text("A" * 1500)

    assert len(chunks) > 1
    assert all(len(chunk) <= 500 for chunk in chunks)


def test_chunk_text_prefers_heading_boundaries():
    text = (
        "\n\n## 第一章\n"
        + "这是第一章的内容。" * 40
        + "\n\n## 第二章\n"
        + "这是第二章的内容。" * 40
    )
    chunks = chunk_text(text)

    assert len(chunks) > 1
    assert any(chunk.lstrip().startswith("## 第二章") for chunk in chunks)


def test_clean_pdf_text_removes_page_number_lines():
    text = "正文内容\n第 1 页\n更多正文内容\nPage 2\n结尾内容\n- 3 -"
    result = _clean_pdf_text(text)

    assert "第 1 页" not in result
    assert "Page 2" not in result
    assert "- 3 -" not in result
    assert "正文内容" in result


def test_clean_pdf_text_removes_consecutive_duplicate_lines():
    result = _clean_pdf_text("公司名称\n公司名称\n正文\n公司名称\n公司名称")
    lines = [line for line in result.split("\n") if line.strip()]

    assert all(lines[index] != lines[index + 1] for index in range(len(lines) - 1))


def test_clean_pdf_text_compresses_excessive_newlines():
    result = _clean_pdf_text("第一行\n\n\n\n第二行")

    assert "\n\n\n" not in result
    assert "第一行" in result
    assert "第二行" in result


def test_clean_pdf_text_preserves_page_markers():
    result = _clean_pdf_text("[--- 第1页 ---]\n正文\n[--- 第2页 ---]\n正文二")

    assert "[--- 第1页 ---]" in result
    assert "[--- 第2页 ---]" in result
