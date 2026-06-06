"""Auth API routes: register, login, me."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.engine import get_db
from src.database.models import User
from src.utils.auth import create_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=4, max_length=100)


class AuthResponse(BaseModel):
    token: str
    user: dict


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 注册时自动创建入门文章
    await _seed_intro_article(db, user.id)

    token = create_token(user.id, user.username)
    return AuthResponse(token=token, user={"id": user.id, "username": user.username})


async def _seed_intro_article(db: AsyncSession, user_id: int):
    """为新注册用户创建一篇入门文章（来自官方介绍模板）。"""
    from src.services.blog_service import create_post
    from src.services.official_intro_service import build_intro_post_payload

    intro_data = build_intro_post_payload()
    await create_post(db, intro_data, user_id)


@router.post("/login")
async def login(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token = create_token(user.id, user.username)
    return AuthResponse(token=token, user={"id": user.id, "username": user.username})


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "created_at": user.created_at.isoformat()}
