"""博客左栏自定义 HTML 测试：AI 工具持久化 + 公开接口返回 + 设置接口。"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.context import current_user_id_cv
from src.database.models import BlogSidebarSettings, User as UserModel
from src.tools.blog import update_blog_sidebar

TEST_USER_ID = 1


@pytest.mark.asyncio
async def test_update_blog_sidebar_upserts_html(db_session: AsyncSession, monkeypatch):
    """update_blog_sidebar 工具：把 HTML upsert 进 BlogSidebarSettings，不动 show_tags。"""
    db_session.add(UserModel(id=TEST_USER_ID, username="sidebarowner", password_hash="mock"))
    await db_session.commit()

    class ToolSession:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.tools.blog.async_session", lambda: ToolSession())
    token = current_user_id_cv.set(TEST_USER_ID)
    try:
        result1 = await update_blog_sidebar.ainvoke({"html": "<div>第一版</div>"})
        # 第二次调用应 upsert（同一 user_id 不新增行）
        result2 = await update_blog_sidebar.ainvoke({"html": "<div>第二版</div>"})
    finally:
        current_user_id_cv.reset(token)

    assert "已更新" in result1
    assert "已更新" in result2
    records = (
        await db_session.execute(
            select(BlogSidebarSettings).where(BlogSidebarSettings.user_id == TEST_USER_ID)
        )
    ).scalars().all()
    assert len(records) == 1
    assert records[0].html == "<div>第二版</div>"
    assert records[0].show_tags is True  # 默认值不被工具改动


@pytest.mark.asyncio
async def test_sidebar_public_and_settings_apis(client: AsyncClient, db_session: AsyncSession):
    """get_public_user 返回 sidebar_html/show_tags；PUT /settings/sidebar 持久化 show_tags。

    conftest 的 override_get_current_user 固定鉴权为 username="testuser"，故 PUT 写入的是
    testuser 的记录——测试须以 testuser 为博主、按 testuser.id 校验，否则 user_id 错配查不到。
    """
    # 确保 testuser 存在并拿到其 id（override_get_current_user 也认这个用户）
    testuser = (
        await db_session.execute(select(UserModel).where(UserModel.username == "testuser"))
    ).scalar_one_or_none()
    if testuser is None:
        testuser = UserModel(username="testuser", password_hash="mock")
        db_session.add(testuser)
        await db_session.commit()
        await db_session.refresh(testuser)

    # 无配置：公开接口 sidebar_html=null、show_tags=True（默认）
    resp = await client.get("/api/v1/public/users/testuser")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sidebar_html"] is None
    assert data["show_tags"] is True

    # owner（即 testuser）关闭标签云：PUT 持久化（client 写 + db_session 读）
    put = await client.put("/api/v1/settings/sidebar", json={"show_tags": False})
    assert put.status_code == 200
    assert put.json()["show_tags"] is False
    record = (
        await db_session.execute(
            select(BlogSidebarSettings).where(BlogSidebarSettings.user_id == testuser.id)
        )
    ).scalar_one_or_none()
    assert record is not None and record.show_tags is False
