"""博客文章与分类路由。"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.utils.auth import get_current_user, get_optional_user
from src.database.models import User
from src.schemas.blog import (
    BlogPostCreate,
    BlogPostListItem,
    BlogPostListResponse,
    BlogPostResponse,
    BlogPostUpdate,
    BlogPublishRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---- Public site reads ----


@router.get("/public/users/{username}")
async def get_public_user(
    username: str,
    db: AsyncSession = Depends(get_db),
    viewer: Optional[User] = Depends(get_optional_user),
):
    from src.services.blog_service import get_user_by_username

    owner = await get_user_by_username(db, username)
    if not owner:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": owner.id,
        "username": owner.username,
        "created_at": owner.created_at.isoformat(),
        "is_owner": bool(viewer and viewer.id == owner.id),
    }


@router.get("/public/users/{username}/posts", response_model=BlogPostListResponse)
async def list_public_user_posts(
    username: str,
    include_drafts: bool = False,
    status: str = None,
    search: str = None,
    page: int = 1,
    per_page: int = 10,
    db: AsyncSession = Depends(get_db),
    viewer: Optional[User] = Depends(get_optional_user),
):
    from src.services.blog_service import get_user_by_username, list_posts

    owner = await get_user_by_username(db, username)
    if not owner:
        raise HTTPException(status_code=404, detail="User not found")

    result = await list_posts(
        db,
        viewer_user_id=viewer.id if viewer else None,
        owner_username=username,
        include_drafts_for_owner=include_drafts,
        status=status,
        search=search,
        page=page,
        per_page=per_page,
    )
    return BlogPostListResponse(
        posts=[BlogPostListItem.model_validate(p) for p in result["posts"]],
        total=result["total"],
        page=result["page"],
        per_page=result["per_page"],
    )


@router.get("/public/users/{username}/posts/{slug}", response_model=BlogPostResponse)
async def get_public_user_post(
    username: str,
    slug: str,
    db: AsyncSession = Depends(get_db),
    viewer: Optional[User] = Depends(get_optional_user),
):
    from src.services.blog_service import get_post_for_site_viewer, increment_view_count

    post = await get_post_for_site_viewer(db, username, slug, viewer.id if viewer else None)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await increment_view_count(db, post.id)
    await db.refresh(post)
    return BlogPostResponse.model_validate(post)


# ---- Posts ----


@router.get("/blog/posts", response_model=BlogPostListResponse)
async def list_blog_posts(
    status: str = None,
    search: str = None,
    page: int = 1,
    per_page: int = 10,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    from src.services.blog_service import list_posts

    result = await list_posts(
        db,
        viewer_user_id=user.id if user else None,
        include_drafts_for_owner=bool(user),
        status=status,
        search=search,
        page=page,
        per_page=per_page,
    )
    return BlogPostListResponse(
        posts=[BlogPostListItem.model_validate(p) for p in result["posts"]],
        total=result["total"],
        page=result["page"],
        per_page=result["per_page"],
    )


@router.get("/blog/posts/{post_id}", response_model=BlogPostResponse)
async def get_blog_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    from src.services.blog_service import get_post, increment_view_count

    post = await get_post(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.status != "published" and (not user or user.id != post.user_id):
        raise HTTPException(status_code=404, detail="Post not found")
    await increment_view_count(db, post_id)
    await db.refresh(post)
    return BlogPostResponse.model_validate(post)


@router.post("/blog/posts", response_model=BlogPostResponse, status_code=201)
async def create_blog_post(data: BlogPostCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_service import create_post

    try:
        post = await create_post(db, data.model_dump(), user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return BlogPostResponse.model_validate(post)


@router.put("/blog/posts/{post_id}", response_model=BlogPostResponse)
async def update_blog_post(post_id: int, data: BlogPostUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_service import update_post

    try:
        post = await update_post(db, post_id, data.model_dump(exclude_unset=True), user.id)
    except ValueError as e:
        msg = str(e)
        if msg == "Post not found":
            raise HTTPException(status_code=404, detail="Post not found")
        raise HTTPException(status_code=400, detail=msg)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return BlogPostResponse.model_validate(post)


@router.delete("/blog/posts/{post_id}")
async def delete_blog_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_service import delete_post

    try:
        deleted = await delete_post(db, post_id, user.id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Post not found")
    if not deleted:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"status": "ok"}


@router.put("/blog/posts/{post_id}/publish", response_model=BlogPostResponse)
async def publish_blog_post(post_id: int, data: BlogPublishRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_service import publish_post

    try:
        post = await publish_post(db, post_id, data.publish, user.id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Post not found")
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return BlogPostResponse.model_validate(post)


@router.post("/blog/posts/{post_id}/generate-cover", response_model=BlogPostResponse)
async def generate_blog_cover(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_cover_service import generate_cover_image
    from src.services.blog_service import get_owned_post, update_post

    post = await get_owned_post(db, post_id, user.id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        cover_image = await generate_cover_image(post)
        updated = await update_post(db, post_id, {"cover_image": cover_image}, user.id)
    except ValueError as e:
        msg = str(e)
        if msg == "Post not found":
            raise HTTPException(status_code=404, detail="Post not found")
        raise HTTPException(status_code=400, detail=msg)
    if not updated:
        raise HTTPException(status_code=404, detail="Post not found")
    return BlogPostResponse.model_validate(updated)


@router.post("/blog/posts/{post_id}/suggest-tags")
async def suggest_blog_tags(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from src.services.blog_service import get_owned_post
    from src.services.blog_tag_service import suggest_tags

    post = await get_owned_post(db, post_id, user.id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        tags = await suggest_tags(post)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="标签生成超时，请稍后重试")
    except Exception:
        logger.exception("suggest_blog_tags failed for post_id=%s", post_id)
        raise HTTPException(status_code=502, detail="标签生成服务暂不可用，请稍后重试")
    return {"tags": tags}
