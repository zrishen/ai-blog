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
    return meta, text[m.end():]


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
        "excerpt": "AI Blog 把写作、资料整理、知识库和 AI 助手放在同一个工作流里，帮助你从灵感记录走到可信发布。",
        "content": "\n\n".join(
            [
                "欢迎来到 AI Blog。它不是一个只负责展示文章的博客系统，而是一个围绕写作、资料、知识和 AI 协作搭建的个人内容工作台。",
                "你可以在这里记录灵感、沉淀资料、整理知识库，也可以让 AI 陪你一起完成选题、研究、起草、润色和发布。",
                "AI Blog 的目标不是让 AI 替你表达，而是帮助你更稳定地思考、更高效地整理、更有依据地写作。",
            ]
        ),
    }
