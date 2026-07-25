"""research/claim CRUD + 证据校验 + 冲突解决单元测试。

锁住 Claim 创建（supported 必须有有效证据）、更新（supported 校验）、
冲突关系解决（接受方需有效证据，解决后 accepted=supported/adopted、rejected=rejected）。
"""

import pytest

from src.database.models import ResearchClaim
from src.services.research.claim import create_claim, resolve_conflict, update_claim
from src.services.research.relation import create_relation


async def test_create_claim_success(db_session, make_topic) -> None:
    topic = await make_topic()
    claim = await create_claim(db_session, topic.id, {"claim_text": "地球是圆的"}, user_id=1)
    assert claim is not None
    assert claim.claim_text == "地球是圆的"
    assert claim.status == "pending"


async def test_create_claim_topic_not_owned_none(db_session, make_topic) -> None:
    topic = await make_topic(user_id=2)
    assert await create_claim(db_session, topic.id, {"claim_text": "X"}, user_id=1) is None


async def test_create_claim_supported_without_evidence_raises(db_session, make_topic) -> None:
    topic = await make_topic()
    with pytest.raises(ValueError, match="Evidence is required"):
        await create_claim(db_session, topic.id, {"claim_text": "X", "status": "supported"}, user_id=1)


async def test_create_claim_supported_with_valid_evidence(db_session, make_topic, make_evidence) -> None:
    topic = await make_topic()
    ev = await make_evidence(topic)  # kind=manual（SUPPORTED）+ quote 非空 → 有效
    claim = await create_claim(db_session, topic.id, {
        "claim_text": "X", "status": "supported", "evidence_ids": [ev.id],
    }, user_id=1)
    assert claim.status == "supported"


async def test_update_claim_to_supported_without_evidence_raises(db_session, make_topic, make_claim) -> None:
    topic = await make_topic()
    claim = await make_claim(topic)
    with pytest.raises(ValueError, match="Evidence is required"):
        await update_claim(db_session, claim.id, {"status": "supported"}, user_id=1)


async def test_resolve_conflict_success(
    db_session, make_topic, make_claim, make_evidence
) -> None:
    topic = await make_topic()
    a = await make_claim(topic, claim_text="A")
    b = await make_claim(topic, claim_text="B")
    ev = await make_evidence(topic)
    # evidence supports a（让 a 有有效证据）
    await create_relation(db_session, topic.id, {
        "from_type": "evidence", "from_id": ev.id,
        "to_type": "claim", "to_id": a.id,
        "relation_type": "supports",
    }, user_id=1)
    # a conflicts_with b
    conflict_rel = await create_relation(db_session, topic.id, {
        "from_type": "claim", "from_id": a.id,
        "to_type": "claim", "to_id": b.id,
        "relation_type": "conflicts_with",
    }, user_id=1)
    resolved = await resolve_conflict(db_session, conflict_rel.id, {
        "accepted_claim_id": a.id, "rejected_claim_id": b.id,
    }, user_id=1)
    assert resolved is not None
    a_db = await db_session.get(ResearchClaim, a.id)
    b_db = await db_session.get(ResearchClaim, b.id)
    assert a_db.status == "supported"
    assert a_db.adopted is True
    assert b_db.status == "rejected"


async def test_resolve_conflict_relation_not_owned_none(db_session, make_topic, make_claim) -> None:
    topic = await make_topic()
    a = await make_claim(topic)
    b = await make_claim(topic, claim_text="B")
    conflict_rel = await create_relation(db_session, topic.id, {
        "from_type": "claim", "from_id": a.id,
        "to_type": "claim", "to_id": b.id,
        "relation_type": "conflicts_with",
    }, user_id=1)
    # 别人无法解决
    assert await resolve_conflict(db_session, conflict_rel.id, {
        "accepted_claim_id": a.id, "rejected_claim_id": b.id,
    }, user_id=2) is None
