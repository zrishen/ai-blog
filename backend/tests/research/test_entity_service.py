"""research/entity CRUD + Claim-Entity 关联单元测试。

锁住实体创建（类型/状态校验、空名拒绝、归一化去重合并）、列表/详情隔离、
更新重名检测、删除、get_or_create 幂等。
"""

import pytest

from src.services.research.entity import (
    create_entity,
    delete_entity,
    get_entity_detail,
    get_or_create_entity,
    list_entities,
    update_entity,
)


async def test_create_entity_success(db_session, make_topic) -> None:
    topic = await make_topic()
    entity = await create_entity(db_session, topic.id, {"name": "OpenAI", "entity_type": "organization"}, user_id=1)
    assert entity is not None
    assert entity.name == "OpenAI"
    assert entity.entity_type == "organization"


async def test_create_entity_invalid_type_defaults_other(db_session, make_topic) -> None:
    topic = await make_topic()
    entity = await create_entity(db_session, topic.id, {"name": "X", "entity_type": "invalid"}, user_id=1)
    assert entity.entity_type == "other"


async def test_create_entity_empty_name_raises(db_session, make_topic) -> None:
    topic = await make_topic()
    with pytest.raises(ValueError, match="name is required"):
        await create_entity(db_session, topic.id, {"name": "   "}, user_id=1)


async def test_create_entity_dedup_merges_higher_confidence(db_session, make_topic) -> None:
    topic = await make_topic()
    first = await create_entity(db_session, topic.id, {"name": "OpenAI", "confidence": 50}, user_id=1)
    # 同名（归一化 + 大小写无关）→ 合并，置信度取大
    second = await create_entity(db_session, topic.id, {"name": "  openai  ", "confidence": 80}, user_id=1)
    assert second.id == first.id
    assert second.confidence == 80


async def test_create_entity_topic_not_owned_none(db_session, make_topic) -> None:
    topic = await make_topic(user_id=2)
    assert await create_entity(db_session, topic.id, {"name": "X"}, user_id=1) is None


async def test_list_entities(db_session, make_topic) -> None:
    topic = await make_topic()
    await create_entity(db_session, topic.id, {"name": "A"}, user_id=1)
    await create_entity(db_session, topic.id, {"name": "B"}, user_id=1)
    entities = await list_entities(db_session, topic.id, user_id=1)
    assert entities is not None
    assert len(entities) == 2


async def test_get_entity_detail_isolated(db_session, make_topic, make_entity) -> None:
    topic = await make_topic()
    entity = await make_entity(topic)
    assert await get_entity_detail(db_session, entity.id, user_id=1) is not None
    assert await get_entity_detail(db_session, entity.id, user_id=2) is None


async def test_update_entity_rename_duplicate_raises(db_session, make_topic) -> None:
    topic = await make_topic()
    await create_entity(db_session, topic.id, {"name": "A"}, user_id=1)
    b = await create_entity(db_session, topic.id, {"name": "B"}, user_id=1)
    with pytest.raises(ValueError, match="already exists"):
        await update_entity(db_session, b.id, {"name": "A"}, user_id=1)


async def test_delete_entity(db_session, make_topic, make_entity) -> None:
    topic = await make_topic()
    entity = await make_entity(topic)
    assert await delete_entity(db_session, entity.id, user_id=1) is True
    assert await get_entity_detail(db_session, entity.id, user_id=1) is None


async def test_get_or_create_entity_idempotent(db_session, make_topic) -> None:
    topic = await make_topic()
    e1 = await get_or_create_entity(db_session, topic.id, "AI", user_id=1)
    e2 = await get_or_create_entity(db_session, topic.id, "ai", user_id=1)  # 归一化同名
    assert e2 is not None and e1 is not None
    assert e2.id == e1.id
