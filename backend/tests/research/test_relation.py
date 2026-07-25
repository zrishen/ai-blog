"""research/relation 关系创建 + 节点归属校验单元测试。

锁住 create_relation 的校验链（topic 归属 → 节点类型合法 → relation_type 合法 →
两端节点存在且归属 → 去重）与 _owned_research_node_exists 的多类型/隔离判断。
此前 research 域仅靠 API 端到端间接覆盖。
"""

import pytest

from src.services.research.relation import (
    _owned_research_node_exists,
    create_relation,
)


# ── _owned_research_node_exists ──

async def test_owned_node_exists_all_types(
    db_session, make_topic, make_source, make_evidence, make_claim, make_entity
) -> None:
    topic = await make_topic()
    source = await make_source(topic)
    evidence = await make_evidence(topic)
    claim = await make_claim(topic)
    entity = await make_entity(topic)
    assert await _owned_research_node_exists(db_session, "source", source.id, topic.id, 1) is True
    assert await _owned_research_node_exists(db_session, "evidence", evidence.id, topic.id, 1) is True
    assert await _owned_research_node_exists(db_session, "claim", claim.id, topic.id, 1) is True
    assert await _owned_research_node_exists(db_session, "entity", entity.id, topic.id, 1) is True


async def test_owned_node_unknown_type_returns_false(db_session, make_topic) -> None:
    topic = await make_topic()
    assert await _owned_research_node_exists(db_session, "unknown", 1, topic.id, 1) is False


async def test_owned_node_not_found_or_other_owner(db_session, make_topic, make_source) -> None:
    topic = await make_topic()
    source = await make_source(topic, user_id=1)
    assert await _owned_research_node_exists(db_session, "source", 9999, topic.id, 1) is False  # 不存在
    assert await _owned_research_node_exists(db_session, "source", source.id, topic.id, 2) is False  # 别人的


# ── create_relation ──

async def test_create_relation_success(db_session, make_topic, make_source, make_evidence) -> None:
    topic = await make_topic()
    source = await make_source(topic)
    evidence = await make_evidence(topic)
    relation = await create_relation(db_session, topic.id, {
        "from_type": "source", "from_id": source.id,
        "to_type": "evidence", "to_id": evidence.id,
        "relation_type": "supports",
    }, user_id=1)
    assert relation is not None
    assert relation.from_type == "source"
    assert relation.to_type == "evidence"
    assert relation.relation_type == "supports"


async def test_create_relation_topic_not_owned_returns_none(db_session, make_topic) -> None:
    topic = await make_topic(user_id=2)  # 别人的 topic
    relation = await create_relation(db_session, topic.id, {
        "from_type": "source", "from_id": 1,
        "to_type": "evidence", "to_id": 1,
        "relation_type": "supports",
    }, user_id=1)
    assert relation is None


async def test_create_relation_invalid_node_type_raises(db_session, make_topic) -> None:
    topic = await make_topic()
    with pytest.raises(ValueError, match="node type"):
        await create_relation(db_session, topic.id, {
            "from_type": "invalid", "from_id": 1,
            "to_type": "evidence", "to_id": 1,
            "relation_type": "supports",
        }, user_id=1)


async def test_create_relation_invalid_relation_type_raises(
    db_session, make_topic, make_source, make_evidence
) -> None:
    topic = await make_topic()
    source = await make_source(topic)
    evidence = await make_evidence(topic)
    with pytest.raises(ValueError, match="Unsupported relation"):
        await create_relation(db_session, topic.id, {
            "from_type": "source", "from_id": source.id,
            "to_type": "evidence", "to_id": evidence.id,
            "relation_type": "invalid_relation",
        }, user_id=1)


async def test_create_relation_source_node_not_found_raises(db_session, make_topic) -> None:
    topic = await make_topic()
    with pytest.raises(ValueError, match="source node not found"):
        await create_relation(db_session, topic.id, {
            "from_type": "source", "from_id": 9999,
            "to_type": "evidence", "to_id": 1,
            "relation_type": "supports",
        }, user_id=1)


async def test_create_relation_dedup_returns_existing(
    db_session, make_topic, make_source, make_evidence
) -> None:
    topic = await make_topic()
    source = await make_source(topic)
    evidence = await make_evidence(topic)
    data = {
        "from_type": "source", "from_id": source.id,
        "to_type": "evidence", "to_id": evidence.id,
        "relation_type": "supports",
    }
    first = await create_relation(db_session, topic.id, data, user_id=1)
    second = await create_relation(db_session, topic.id, data, user_id=1)
    assert second is not None
    assert second.id == first.id  # 去重，返回已存在
