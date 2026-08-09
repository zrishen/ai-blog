"""Working-copy body seam for blog consumers.

The implementation deliberately remains the legacy DB body until the file
storage cutover. Consumers must use this seam so that cutover is localized.
"""

from src.database.models import BlogPost


def get_post_body(post: BlogPost) -> str:
    """Return the author's editable working-copy body.

    This is exactly ``post.content`` in the current legacy-storage phase.
    """

    return post.content
