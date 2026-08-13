"""官方介绍内容服务 —— 从受保护模板读取，供注册 seed 和启动同步共用。"""

import re
from pathlib import Path

import yaml

from src.config import DATA_DIR

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _get_template_path() -> Path:
    return DATA_DIR / "templates" / "ai-blog-intro.md"


def _parse_frontmatter(text: str):
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    return meta, text[m.end() :]


def build_intro_post_payload() -> dict:
    """返回可传给 blog_service.create_post() 的 dict。"""
    path = _get_template_path()
    if path.exists():
        text = path.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(text)
        return {
            "title": meta.get("title", "AI Blog"),
            "slug": meta.get("slug", "ai-blog-intro"),
            "tags": meta.get("tags", ""),
            "status": meta.get("status", "published"),
            "author": meta.get("author", "ai-blog"),
            "excerpt": meta.get("excerpt", ""),
            "content": body.strip(),
        }
    return {
        "title": "AI Blog：你的 AI 写作与知识整理空间",
        "slug": "ai-blog-intro",
        "tags": "AI写作,博客,知识管理",
        "status": "published",
        "author": "ai-blog",
        "excerpt": "从灵感、资料到发布：用 AI Blog 搭建属于自己的写作与知识整理工作流。",
        "content": "\n\n".join(
            [
                "> AI Blog 是你的个人内容工作台：把思考、资料、写作与 AI 协作放在同一条清晰的工作流里。",
                "欢迎来到 AI Blog。它不只是展示文章的博客系统，更是一个为长期写作与知识积累准备的空间。"
                "你可以从一条灵感开始，逐步沉淀资料、梳理观点、完成文章，并把可靠的内容发布出去。",
                "## 你可以在这里做什么",
                "### 记录与写作\n\n- 随时新建文章，记录问题、灵感和还未成形的观点。\n"
                "- 在编辑过程中持续修改，让草稿自然演变为可发布的文章。\n"
                "- 使用 Markdown 保持内容结构清晰，方便回看、复用和扩展。",
                "### 整理资料与文件\n\n- 上传论文、报告、笔记和参考资料，集中管理自己的文件库。\n"
                "- 将值得长期使用的资料加入知识库，写作时可以更快找回依据。\n"
                "- 通过回收站安全地整理内容，避免误删打断工作。",
                "### 与 AI 协作\n\n- 让 AI 协助拆解选题、补充研究方向、起草段落和润色表达。\n"
                "- 在对话中引用文章与资料，把讨论建立在你的内容之上。\n"
                "- 使用 AI 来提出问题、发现盲点和整理线索，而不是替代你的判断。",
                "## 一个推荐的工作流",
                "1. **捕捉**：先把想到的问题、素材链接或一句判断写下来。\n"
                "2. **沉淀**：将相关文件与资料放进文件库，标记值得反复使用的内容。\n"
                "3. **研究**：围绕核心问题收集证据，区分事实、观点与待验证的假设。\n"
                "4. **写作**：先搭建文章结构，再逐段补充论点、例子和来源。\n"
                "5. **校对与发布**：检查表达是否准确、结构是否连贯，再将完成的版本发布。",
                "## 让 AI 服务于你的表达",
                "好的写作仍然需要你的经验、取舍和立场。AI Blog 希望帮你减少整理和重复劳动，"
                "把更多时间留给思考：为什么这个问题值得写？证据是否足够？读者真正需要得到什么？",
                "当你保留这些判断，AI 就能成为可靠的协作者——帮助你更稳定地思考、更高效地整理、更有依据地写作。",
                "## 现在就开始\n\n新建一篇文章，写下你最近想弄明白的一件事。"
                "无需等到准备充分；一个清晰的问题，就是一篇好文章的开始。",
            ]
        ),
    }
