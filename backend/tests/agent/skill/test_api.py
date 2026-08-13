"""Skill 目录端点 + 用户 skill 设置端点测试。

覆盖：catalog 投影/认证、GET 默认不写 DB、PUT 子集/显式全关/去重/未知 id 422 不覆盖旧值/用户隔离/upsert 单行。
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.config import settings
from src.database.models import UserSkillSettings
from src.main import app
from src.utils.auth import get_current_user, get_optional_user


@pytest.fixture(autouse=True)
def real_auth():
    """conftest 把所有认证请求都识别为 testuser，这里临时还原为真实 token 认证。"""
    saved_current = app.dependency_overrides.get(get_current_user)
    saved_optional = app.dependency_overrides.get(get_optional_user)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_optional_user, None)
    yield
    if saved_current is not None:
        app.dependency_overrides[get_current_user] = saved_current
    if saved_optional is not None:
        app.dependency_overrides[get_optional_user] = saved_optional


async def _register(client: AsyncClient, username: str) -> tuple[str, int]:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "password": "test1234",
            "invite_code": settings.registration_invite_code,
        },
    )
    assert resp.status_code == 201
    return resp.json()["access_token"], resp.json()["user"]["id"]


@pytest.mark.asyncio
async def test_list_skills_projects_registry_in_order(client: AsyncClient):
    token, _ = await _register(client, "skill_catalog")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/v1/skills", headers=headers)
    assert resp.status_code == 200
    skills = resp.json()["skills"]
    assert [s["id"] for s in skills] == ["writing", "knowledge", "memory"]
    # 不暴露内部字段
    assert set(skills[0].keys()) == {"id", "name", "description"}
    assert skills[0]["name"] == "写作"
    assert skills[1]["name"] == "知识库"
    assert skills[2]["name"] == "记忆"


@pytest.mark.asyncio
async def test_list_skills_requires_auth(client: AsyncClient):
    resp = await client.get("/api/v1/skills")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_skill_settings_returns_default_without_writing_db(
    client: AsyncClient, db_session
):
    token, user_id = await _register(client, "skill_default")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/api/v1/settings/skills", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"enabled_skills": ["writing", "knowledge", "memory"]}

    # GET 不创建行（保持「无偏好」与「显式全关」可区分）
    record = (
        await db_session.execute(
            select(UserSkillSettings).where(UserSkillSettings.user_id == user_id)
        )
    ).scalar_one_or_none()
    assert record is None


@pytest.mark.asyncio
async def test_put_skill_settings_subset_and_get_roundtrip(client: AsyncClient, db_session):
    token, user_id = await _register(client, "skill_subset")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put(
        "/api/v1/settings/skills",
        headers=headers,
        json={"enabled_skills": ["memory", "writing"]},
    )
    assert resp.status_code == 200
    # 按 registry 顺序规范化，去重
    assert resp.json() == {"enabled_skills": ["writing", "memory"]}

    got = await client.get("/api/v1/settings/skills", headers=headers)
    assert got.json() == {"enabled_skills": ["writing", "memory"]}

    record = (
        await db_session.execute(
            select(UserSkillSettings).where(UserSkillSettings.user_id == user_id)
        )
    ).scalar_one()
    assert record.enabled_skills == ["writing", "memory"]


@pytest.mark.asyncio
async def test_put_empty_list_means_explicit_all_off(client: AsyncClient):
    token, _ = await _register(client, "skill_alloff")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.put(
        "/api/v1/settings/skills", headers=headers, json={"enabled_skills": []}
    )
    assert resp.status_code == 200
    assert resp.json() == {"enabled_skills": []}

    got = await client.get("/api/v1/settings/skills", headers=headers)
    assert got.json() == {"enabled_skills": []}


@pytest.mark.asyncio
async def test_put_unknown_skill_id_returns_422_and_preserves_old_value(
    client: AsyncClient, db_session
):
    token, user_id = await _register(client, "skill_unknown")
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/settings/skills",
        headers=headers,
        json={"enabled_skills": ["writing"]},
    )

    bad = await client.put(
        "/api/v1/settings/skills",
        headers=headers,
        json={"enabled_skills": ["writing", "bogus"]},
    )
    assert bad.status_code == 422
    assert bad.json()["code"] == "validation_failed"
    assert bad.json()["details"]["unknown_skill_ids"] == ["bogus"]

    # 未知 id 不覆盖既有保存值
    record = (
        await db_session.execute(
            select(UserSkillSettings).where(UserSkillSettings.user_id == user_id)
        )
    ).scalar_one()
    assert record.enabled_skills == ["writing"]


@pytest.mark.asyncio
async def test_skill_settings_isolated_per_user(client: AsyncClient):
    token_a, _ = await _register(client, "skill_iso_a")
    token_b, _ = await _register(client, "skill_iso_b")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    await client.put(
        "/api/v1/settings/skills", headers=headers_a, json={"enabled_skills": ["writing"]}
    )
    await client.put(
        "/api/v1/settings/skills", headers=headers_b, json={"enabled_skills": ["memory"]}
    )

    got_a = await client.get("/api/v1/settings/skills", headers=headers_a)
    got_b = await client.get("/api/v1/settings/skills", headers=headers_b)
    assert got_a.json()["enabled_skills"] == ["writing"]
    assert got_b.json()["enabled_skills"] == ["memory"]


@pytest.mark.asyncio
async def test_put_upserts_single_row(client: AsyncClient, db_session):
    token, user_id = await _register(client, "skill_upsert")
    headers = {"Authorization": f"Bearer {token}"}

    await client.put(
        "/api/v1/settings/skills", headers=headers, json={"enabled_skills": ["writing"]}
    )
    await client.put(
        "/api/v1/settings/skills", headers=headers, json={"enabled_skills": ["writing", "memory"]}
    )

    rows = (
        await db_session.execute(
            select(UserSkillSettings).where(UserSkillSettings.user_id == user_id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].enabled_skills == ["writing", "memory"]


@pytest.mark.asyncio
async def test_settings_skills_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/settings/skills")).status_code in (401, 403)
    assert (
        await client.put("/api/v1/settings/skills", json={"enabled_skills": []})
    ).status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_filters_legacy_unknown_ids(client: AsyncClient, db_session):
    """registry 演进容错：已保存值含已不存在的 id，GET 过滤而非抛错（被动读不阻塞）。"""
    token, user_id = await _register(client, "skill_legacy")
    headers = {"Authorization": f"Bearer {token}"}

    db_session.add(
        UserSkillSettings(
            user_id=user_id, enabled_skills=["writing", "ghost_skill"]
        )
    )
    await db_session.commit()

    got = await client.get("/api/v1/settings/skills", headers=headers)
    assert got.status_code == 200
    assert got.json() == {"enabled_skills": ["writing"]}
