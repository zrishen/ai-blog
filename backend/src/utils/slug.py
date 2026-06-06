import re


def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w一-鿿\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s[:200] or "post"
