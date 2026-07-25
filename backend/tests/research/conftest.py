"""research 域测试数据工厂 fixture。

建 topic / source / evidence / claim / entity，供 relation / topic / entity / claim 等
service 单测复用。每个工厂返回 async 构造函数，按需调 `await make_topic()` 等。
"""

import pytest_asyncio

from src.database.models import (
    ResearchClaim,
    ResearchEntity,
    ResearchEvidence,
    ResearchSource,
    ResearchTopic,
)


@pytest_asyncio.fixture
async def make_topic(db_session):
    async def _make(*, user_id: int = 1, title: str = "测试主题", **kw) -> ResearchTopic:
        topic = ResearchTopic(user_id=user_id, title=title, **kw)
        db_session.add(topic)
        await db_session.commit()
        await db_session.refresh(topic)
        return topic

    return _make


@pytest_asyncio.fixture
async def make_source(db_session):
    async def _make(topic, *, user_id: int = 1, title: str = "来源", **kw) -> ResearchSource:
        src = ResearchSource(topic_id=topic.id, user_id=user_id, title=title, **kw)
        db_session.add(src)
        await db_session.commit()
        await db_session.refresh(src)
        return src

    return _make


@pytest_asyncio.fixture
async def make_evidence(db_session):
    async def _make(topic, *, user_id: int = 1, quote: str = "证据原文", **kw) -> ResearchEvidence:
        ev = ResearchEvidence(topic_id=topic.id, user_id=user_id, quote=quote, **kw)
        db_session.add(ev)
        await db_session.commit()
        await db_session.refresh(ev)
        return ev

    return _make


@pytest_asyncio.fixture
async def make_claim(db_session):
    async def _make(topic, *, user_id: int = 1, claim_text: str = "声明", **kw) -> ResearchClaim:
        claim = ResearchClaim(topic_id=topic.id, user_id=user_id, claim_text=claim_text, **kw)
        db_session.add(claim)
        await db_session.commit()
        await db_session.refresh(claim)
        return claim

    return _make


@pytest_asyncio.fixture
async def make_entity(db_session):
    async def _make(topic, *, user_id: int = 1, name: str = "实体", **kw) -> ResearchEntity:
        ent = ResearchEntity(topic_id=topic.id, user_id=user_id, name=name, **kw)
        db_session.add(ent)
        await db_session.commit()
        await db_session.refresh(ent)
        return ent

    return _make
