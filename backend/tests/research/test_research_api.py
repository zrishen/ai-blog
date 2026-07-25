"""研究图谱 API 测试。"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database.models import (
    BlogPost,
    BlogPostClaimLink,
    BlogPostResearchLink,
    ResearchClaim,
    ResearchClaimEntityLink,
    ResearchEntity,
    ResearchEvidence,
    ResearchProposal,
    ResearchRelation,
    ResearchTopic,
    User,
)
from src.main import app
from src.services import research as research_service
from src.utils.auth import get_current_user


def _disable_background_research(monkeypatch):
    async def fake_execute_research_run(run_id, topic_id, user_id):
        return None

    from src.services.research import run
    monkeypatch.setattr(run, "_execute_research_run", fake_execute_research_run)


@pytest.mark.asyncio
async def test_create_and_list_research_topics(client: AsyncClient):
    create_resp = await client.post("/api/v1/research/topics", json={
        "title": "AI 模型发展",
        "description": "跟踪模型发布时间、能力和争议信息。",
    })
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["title"] == "AI 模型发展"
    assert created["status"] == "draft"
    assert created["source_count"] == 0
    assert created["claim_count"] == 0
    assert created["conflict_count"] == 0

    list_resp = await client.get("/api/v1/research/topics")
    assert list_resp.status_code == 200
    topics = list_resp.json()
    assert len(topics) == 1
    assert topics[0]["id"] == created["id"]


@pytest.mark.asyncio
async def test_run_research_topic_is_idempotent(client: AsyncClient, monkeypatch):
    _disable_background_research(monkeypatch)
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "可信写作"})
    topic_id = topic_resp.json()["id"]

    headers = {"Idempotency-Key": "same-run"}
    first_resp = await client.post(f"/api/v1/research/topics/{topic_id}/run", headers=headers)
    second_resp = await client.post(f"/api/v1/research/topics/{topic_id}/run", headers=headers)

    assert first_resp.status_code == 202
    assert second_resp.status_code == 202
    first = first_resp.json()
    second = second_resp.json()
    assert first["id"] == second["id"]
    assert first["status"] == "running"
    assert first["progress"] == research_service.DEFAULT_RUN_PROGRESS


@pytest.mark.asyncio
async def test_list_research_runs_returns_latest_first_for_owned_topic(client: AsyncClient, monkeypatch):
    _disable_background_research(monkeypatch)
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "运行历史"})
    topic_id = topic_resp.json()["id"]
    first_resp = await client.post(f"/api/v1/research/topics/{topic_id}/run", headers={"Idempotency-Key": "run-a"})
    second_resp = await client.post(f"/api/v1/research/topics/{topic_id}/run", headers={"Idempotency-Key": "run-b"})

    runs_resp = await client.get(f"/api/v1/research/topics/{topic_id}/runs")

    assert runs_resp.status_code == 200
    runs = runs_resp.json()
    assert [run["id"] for run in runs] == [second_resp.json()["id"], first_resp.json()["id"]]
    assert runs[0]["progress"]["search_sources"] == "queued"


@pytest.mark.asyncio
async def test_run_research_topic_starts_with_queued_progress(client: AsyncClient, monkeypatch):
    _disable_background_research(monkeypatch)
    topic_resp = await client.post("/api/v1/research/topics", json={
        "title": "可信 AI 写作",
        "description": "研究 RAG 如何降低 AI 幻觉。",
    })
    topic_id = topic_resp.json()["id"]

    run_resp = await client.post(f"/api/v1/research/topics/{topic_id}/run", headers={"Idempotency-Key": "complete-run"})

    assert run_resp.status_code == 202
    run = run_resp.json()
    assert run["status"] == "running"
    assert run["finished_at"] is None
    assert run["progress"] == research_service.DEFAULT_RUN_PROGRESS


@pytest.mark.asyncio
async def test_generate_research_draft_preview_returns_stable_fields(client: AsyncClient, db_session: AsyncSession):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "可信写作草稿"})
    topic_id = topic_resp.json()["id"]
    claim = ResearchClaim(
        topic_id=topic_id,
        user_id=1,
        claim_text="RAG 可以通过引用外部证据降低 AI 幻觉风险。",
        status="supported",
        confidence=91,
        adopted=True,
    )
    db_session.add(claim)
    await db_session.commit()

    draft_resp = await client.post(f"/api/v1/research/topics/{topic_id}/draft-preview")

    assert draft_resp.status_code == 200
    draft = draft_resp.json()
    assert set(draft) == {"title", "outline", "content", "references"}
    assert draft["title"] == "可信写作草稿"
    assert draft["outline"]
    assert "RAG 可以通过引用外部证据降低 AI 幻觉风险。" in draft["content"]
    assert draft["references"] == []


@pytest.mark.asyncio
async def test_attach_topic_to_post_creates_research_snapshot(client: AsyncClient, db_session: AsyncSession):
    post = BlogPost(
        title="草稿",
        slug="draft",
        content="内容",
        status="draft",
        user_id=1,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    topic_resp = await client.post("/api/v1/research/topics", json={"title": "文章依据"})
    topic_id = topic_resp.json()["id"]

    attach_resp = await client.post(f"/api/v1/blog/posts/{post.id}/research-topics", json={"topic_id": topic_id})
    assert attach_resp.status_code == 201
    link = attach_resp.json()
    assert link["post_id"] == post.id
    assert link["topic_id"] == topic_id
    assert link["snapshot"]["version"] == 1
    assert link["snapshot"]["topic"]["id"] == topic_id

    summary_resp = await client.get(f"/api/v1/blog/posts/{post.id}/research-summary")
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    assert summary["post_id"] == post.id
    assert len(summary["topics"]) == 1
    assert summary["topics"][0]["id"] == topic_id


@pytest.mark.asyncio
async def test_missing_evidence_claim_cannot_be_supported(client: AsyncClient):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "证据约束"})
    topic_id = topic_resp.json()["id"]

    claim_resp = await client.post(f"/api/v1/research/topics/{topic_id}/claims", json={
        "claim_text": "某模型已经发布。",
        "status": "supported",
    })

    assert claim_resp.status_code == 400
    assert "Evidence" in claim_resp.json()["detail"]


@pytest.mark.asyncio
async def test_other_user_cannot_read_or_modify_research_topic(client: AsyncClient, db_session: AsyncSession):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "私有主题"})
    topic_id = topic_resp.json()["id"]

    other = User(username="other", password_hash="mock")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    previous_override = app.dependency_overrides[get_current_user]

    async def override_other_user():
        return other

    app.dependency_overrides[get_current_user] = override_other_user
    try:
        get_resp = await client.get(f"/api/v1/research/topics/{topic_id}")
        patch_resp = await client.patch(f"/api/v1/research/topics/{topic_id}", json={"title": "越权修改"})
    finally:
        app.dependency_overrides[get_current_user] = previous_override

    assert get_resp.status_code == 404
    assert patch_resp.status_code == 404


@pytest.mark.asyncio
async def test_ai_generated_note_evidence_cannot_support_claim(client: AsyncClient, db_session: AsyncSession):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "证据类型"})
    topic_id = topic_resp.json()["id"]

    evidence = ResearchEvidence(
        topic_id=topic_id,
        user_id=1,
        quote="AI 自己总结出的句子。",
        kind="ai_generated_note",
    )
    db_session.add(evidence)
    await db_session.commit()
    await db_session.refresh(evidence)

    claim_resp = await client.post(f"/api/v1/research/topics/{topic_id}/claims", json={
        "claim_text": "这个结论来自 AI note。",
        "status": "supported",
        "evidence_ids": [evidence.id],
    })

    assert claim_resp.status_code == 400
    assert "Evidence" in claim_resp.json()["detail"]


@pytest.mark.asyncio
async def test_post_research_snapshot_freezes_claim_text(client: AsyncClient, db_session: AsyncSession):
    post = BlogPost(
        title="快照草稿",
        slug="snapshot-draft",
        content="内容",
        status="draft",
        user_id=1,
    )
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)

    topic_resp = await client.post("/api/v1/research/topics", json={"title": "快照主题"})
    topic_id = topic_resp.json()["id"]
    claim = ResearchClaim(
        topic_id=topic_id,
        user_id=1,
        claim_text="原始事实",
        status="supported",
        confidence=90,
        adopted=True,
    )
    db_session.add(claim)
    await db_session.commit()
    await db_session.refresh(claim)

    attach_resp = await client.post(f"/api/v1/blog/posts/{post.id}/research-topics", json={"topic_id": topic_id})
    assert attach_resp.status_code == 201
    assert attach_resp.json()["snapshot"]["claims"][0]["claim_text"] == "原始事实"

    claim.claim_text = "后续更新事实"
    await db_session.commit()
    link_result = await db_session.execute(select(BlogPostResearchLink).where(BlogPostResearchLink.post_id == post.id))
    link = link_result.scalar_one()

    assert link.snapshot_json["claims"][0]["claim_text"] == "原始事实"


@pytest.mark.asyncio
async def test_research_entity_crud_updates_topic_detail(client: AsyncClient):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "实体 CRUD"})
    topic_id = topic_resp.json()["id"]

    create_resp = await client.post(f"/api/v1/research/topics/{topic_id}/entities", json={
        "name": "RAG",
        "entity_type": "technology",
        "description": "检索增强生成",
        "confidence": 91,
        "aliases": ["Retrieval-Augmented Generation"],
    })
    assert create_resp.status_code == 201
    entity = create_resp.json()
    assert entity["name"] == "RAG"
    assert entity["entity_type"] == "technology"
    assert entity["confidence"] == 91
    assert entity["aliases_json"] == ["Retrieval-Augmented Generation"]

    detail_resp = await client.get(f"/api/v1/research/topics/{topic_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["entity_count"] == 1
    assert detail["entities"][0]["id"] == entity["id"]

    list_resp = await client.get(f"/api/v1/research/topics/{topic_id}/entities")
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["id"] == entity["id"]

    patch_resp = await client.patch(f"/api/v1/research/entities/{entity['id']}", json={
        "description": "通过检索外部资料增强生成结果",
        "confidence": 96,
        "status": "active",
    })
    assert patch_resp.status_code == 200
    patched = patch_resp.json()
    assert patched["description"] == "通过检索外部资料增强生成结果"
    assert patched["confidence"] == 96

    delete_resp = await client.delete(f"/api/v1/research/entities/{entity['id']}")
    assert delete_resp.status_code == 204

    after_delete_resp = await client.get(f"/api/v1/research/topics/{topic_id}")
    assert after_delete_resp.status_code == 200
    after_delete = after_delete_resp.json()
    assert after_delete["entity_count"] == 0
    assert after_delete["entities"] == []


@pytest.mark.asyncio
async def test_claim_entity_names_create_links_and_mentions_relation(client: AsyncClient):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "Claim 实体绑定"})
    topic_id = topic_resp.json()["id"]

    claim_resp = await client.post(f"/api/v1/research/topics/{topic_id}/claims", json={
        "claim_text": "RAG 可以通过检索外部资料降低 AI 幻觉风险。",
        "entity_names": ["RAG", "AI 幻觉"],
    })
    assert claim_resp.status_code == 201
    claim = claim_resp.json()
    assert len(claim["entity_ids"]) == 2

    detail_resp = await client.get(f"/api/v1/research/topics/{topic_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    entity_by_name = {entity["name"]: entity for entity in detail["entities"]}
    assert set(entity_by_name) == {"RAG", "AI 幻觉"}
    assert len(detail["claim_entity_links"]) == 2
    assert {link["claim_id"] for link in detail["claim_entity_links"]} == {claim["id"]}
    assert {link["entity_id"] for link in detail["claim_entity_links"]} == set(claim["entity_ids"])

    mentions = [
        relation for relation in detail["relations"]
        if relation["from_type"] == "claim"
        and relation["from_id"] == claim["id"]
        and relation["to_type"] == "entity"
        and relation["relation_type"] == "mentions"
    ]
    assert {relation["to_id"] for relation in mentions} == set(claim["entity_ids"])


@pytest.mark.asyncio
async def test_applied_proposals_create_entities_and_claim_entity_links(client: AsyncClient, db_session: AsyncSession):
    topic_resp = await client.post("/api/v1/research/topics", json={"title": "实体提案"})
    topic_id = topic_resp.json()["id"]

    entity_proposal = ResearchProposal(
        topic_id=topic_id,
        user_id=1,
        proposal_type="new_entity",
        title="新增 RAG 实体",
        payload_json={
            "name": "RAG",
            "entity_type": "technology",
            "description": "检索增强生成",
            "confidence": 88,
            "aliases": ["Retrieval-Augmented Generation"],
        },
        status="pending",
    )
    db_session.add(entity_proposal)
    await db_session.commit()
    await db_session.refresh(entity_proposal)

    apply_entity_resp = await client.patch(f"/api/v1/research/proposals/{entity_proposal.id}", json={"status": "applied"})
    assert apply_entity_resp.status_code == 200

    entity_result = await db_session.execute(
        select(ResearchEntity).where(ResearchEntity.topic_id == topic_id, ResearchEntity.name == "RAG")
    )
    entity = entity_result.scalar_one()
    assert entity.entity_type == "technology"
    assert entity.confidence == 88

    claim_proposal = ResearchProposal(
        topic_id=topic_id,
        user_id=1,
        proposal_type="new_claim",
        title="新增 Claim 并绑定实体",
        payload_json={
            "claim_text": "RAG 能降低 AI 幻觉风险。",
            "confidence": 82,
            "entity_names": ["RAG", "AI 幻觉"],
        },
        status="pending",
    )
    db_session.add(claim_proposal)
    await db_session.commit()
    await db_session.refresh(claim_proposal)

    apply_claim_resp = await client.patch(f"/api/v1/research/proposals/{claim_proposal.id}", json={"status": "applied"})
    assert apply_claim_resp.status_code == 200

    claim_result = await db_session.execute(
        select(ResearchClaim).where(ResearchClaim.topic_id == topic_id, ResearchClaim.claim_text == "RAG 能降低 AI 幻觉风险。")
    )
    claim = claim_result.scalar_one()
    assert claim.status == "pending"

    links_result = await db_session.execute(
        select(ResearchClaimEntityLink).where(ResearchClaimEntityLink.claim_id == claim.id)
    )
    links = links_result.scalars().all()
    assert len(links) == 2

    relation_result = await db_session.execute(
        select(ResearchRelation).where(
            ResearchRelation.topic_id == topic_id,
            ResearchRelation.from_type == "claim",
            ResearchRelation.from_id == claim.id,
            ResearchRelation.to_type == "entity",
            ResearchRelation.relation_type == "mentions",
        )
    )
    assert len(relation_result.scalars().all()) == 2


@pytest.mark.asyncio
async def test_attach_adopted_claims_for_topic_to_post_links_only_adopted_claims(db_session: AsyncSession):
    from src.services.research import attach_adopted_claims_for_topic_to_post, get_blog_research_summary

    post = BlogPost(title="可信写作草稿", slug="trusted-draft", content="内容", status="draft", user_id=1)
    topic = ResearchTopic(title="可信写作主题", status="draft", user_id=1)
    db_session.add_all([post, topic])
    await db_session.commit()
    await db_session.refresh(post)
    await db_session.refresh(topic)

    adopted_claim = ResearchClaim(
        topic_id=topic.id,
        user_id=1,
        claim_text="RAG 可以降低 AI 幻觉风险。",
        status="supported",
        confidence=90,
        adopted=True,
    )
    pending_claim = ResearchClaim(
        topic_id=topic.id,
        user_id=1,
        claim_text="待审核事实不应自动进入文章。",
        status="pending",
        confidence=70,
        adopted=False,
    )
    db_session.add_all([adopted_claim, pending_claim])
    await db_session.commit()
    await db_session.refresh(adopted_claim)

    linked_count = await attach_adopted_claims_for_topic_to_post(db_session, post.id, topic.id, 1, "AI 可信写作自动关联")
    second_linked_count = await attach_adopted_claims_for_topic_to_post(db_session, post.id, topic.id, 1, "AI 可信写作自动关联")

    summary = await get_blog_research_summary(db_session, post.id, 1)
    link_result = await db_session.execute(select(BlogPostClaimLink).where(BlogPostClaimLink.post_id == post.id))
    links = link_result.scalars().all()

    assert linked_count == 1
    assert second_linked_count == 0
    assert summary is not None
    assert [claim["claim_text"] for claim in summary["claims"]] == ["RAG 可以降低 AI 幻觉风险。"]
    assert len(links) == 1
    assert links[0].claim_id == adopted_claim.id


@pytest.mark.asyncio
async def test_chat_blog_tool_end_auto_links_research_context(monkeypatch, db_session: AsyncSession):
    from tests.conftest import TestSessionLocal
    from src.services.chat import references as chat_service
    from src.services.research import get_blog_research_summary

    post = BlogPost(title="AI 生成文章", slug="ai-generated-post", content="内容", status="draft", user_id=1)
    topic = ResearchTopic(title="AI 写作主题", status="draft", user_id=1)
    db_session.add_all([post, topic])
    await db_session.commit()
    await db_session.refresh(post)
    await db_session.refresh(topic)

    claim = ResearchClaim(
        topic_id=topic.id,
        user_id=1,
        claim_text="可信写作应基于已采用事实生成。",
        status="supported",
        confidence=92,
        adopted=True,
    )
    db_session.add(claim)
    await db_session.commit()

    monkeypatch.setattr(chat_service, "async_session", TestSessionLocal)

    result = await chat_service._auto_link_research_context_to_blog_post(
        {"post_id": post.id},
        topic.id,
        1,
        enabled=True,
    )

    summary = await get_blog_research_summary(db_session, post.id, 1)

    assert result == {"topic_linked": True, "claim_linked_count": 1}
    assert summary is not None
    assert summary["topics"][0]["id"] == topic.id
    assert [claim["claim_text"] for claim in summary["claims"]] == ["可信写作应基于已采用事实生成。"]


async def _create_conflict_fixture(db_session: AsyncSession):
    owner = User(username="testuser", password_hash="mock")
    db_session.add(owner)
    await db_session.commit()
    await db_session.refresh(owner)

    topic = ResearchTopic(title="冲突裁决主题", status="draft", user_id=owner.id)
    db_session.add(topic)
    await db_session.commit()
    await db_session.refresh(topic)

    from_claim = ResearchClaim(
        topic_id=topic.id,
        user_id=owner.id,
        claim_text="事实 A 更符合当前证据。",
        status="conflicting",
        confidence=90,
        adopted=False,
    )
    to_claim = ResearchClaim(
        topic_id=topic.id,
        user_id=owner.id,
        claim_text="事实 B 与事实 A 存在冲突。",
        status="conflicting",
        confidence=88,
        adopted=False,
    )
    db_session.add_all([from_claim, to_claim])
    await db_session.commit()
    await db_session.refresh(from_claim)
    await db_session.refresh(to_claim)

    from_evidence = ResearchEvidence(
        topic_id=topic.id,
        user_id=owner.id,
        quote="支持事实 A 的原文证据。",
        kind="manual",
    )
    to_evidence = ResearchEvidence(
        topic_id=topic.id,
        user_id=owner.id,
        quote="支持事实 B 的原文证据。",
        kind="manual",
    )
    db_session.add_all([from_evidence, to_evidence])
    await db_session.commit()
    await db_session.refresh(from_evidence)
    await db_session.refresh(to_evidence)

    db_session.add_all([
        ResearchRelation(
            topic_id=topic.id,
            user_id=owner.id,
            from_type="evidence",
            from_id=from_evidence.id,
            to_type="claim",
            to_id=from_claim.id,
            relation_type="supports",
        ),
        ResearchRelation(
            topic_id=topic.id,
            user_id=owner.id,
            from_type="evidence",
            from_id=to_evidence.id,
            to_type="claim",
            to_id=to_claim.id,
            relation_type="supports",
        ),
    ])
    conflict = ResearchRelation(
        topic_id=topic.id,
        user_id=owner.id,
        from_type="claim",
        from_id=from_claim.id,
        to_type="claim",
        to_id=to_claim.id,
        relation_type="conflicts_with",
    )
    db_session.add(conflict)
    await db_session.commit()
    await db_session.refresh(conflict)

    return topic, from_claim, to_claim, conflict


@pytest.mark.asyncio
async def test_resolve_conflict_accepts_from_claim_and_rejects_to_claim(client: AsyncClient, db_session: AsyncSession):
    _, from_claim, to_claim, conflict = await _create_conflict_fixture(db_session)

    resolve_resp = await client.post(f"/api/v1/research/conflicts/{conflict.id}/resolve", json={
        "accepted_claim_id": from_claim.id,
        "rejected_claim_id": to_claim.id,
    })

    assert resolve_resp.status_code == 200
    relation = resolve_resp.json()
    assert relation["metadata_json"]["resolution"] == "accepted_rejected"
    assert relation["metadata_json"]["accepted_claim_id"] == from_claim.id
    assert relation["metadata_json"]["rejected_claim_id"] == to_claim.id

    await db_session.refresh(from_claim)
    await db_session.refresh(to_claim)
    assert from_claim.status == "supported"
    assert from_claim.adopted is True
    assert to_claim.status == "rejected"
    assert to_claim.adopted is False


@pytest.mark.asyncio
async def test_resolve_conflict_accepts_to_claim_and_rejects_from_claim(client: AsyncClient, db_session: AsyncSession):
    _, from_claim, to_claim, conflict = await _create_conflict_fixture(db_session)

    resolve_resp = await client.post(f"/api/v1/research/conflicts/{conflict.id}/resolve", json={
        "accepted_claim_id": to_claim.id,
        "rejected_claim_id": from_claim.id,
    })

    assert resolve_resp.status_code == 200
    relation = resolve_resp.json()
    assert relation["metadata_json"]["accepted_claim_id"] == to_claim.id
    assert relation["metadata_json"]["rejected_claim_id"] == from_claim.id

    await db_session.refresh(from_claim)
    await db_session.refresh(to_claim)
    assert to_claim.status == "supported"
    assert to_claim.adopted is True
    assert from_claim.status == "rejected"
    assert from_claim.adopted is False


@pytest.mark.asyncio
async def test_resolve_conflict_requires_evidence_for_accepted_claim(client: AsyncClient, db_session: AsyncSession):
    _, from_claim, to_claim, conflict = await _create_conflict_fixture(db_session)
    supports_result = await db_session.execute(
        select(ResearchRelation).where(
            ResearchRelation.to_type == "claim",
            ResearchRelation.to_id == from_claim.id,
            ResearchRelation.relation_type == "supports",
        )
    )
    for relation in supports_result.scalars().all():
        await db_session.delete(relation)
    await db_session.commit()

    resolve_resp = await client.post(f"/api/v1/research/conflicts/{conflict.id}/resolve", json={
        "accepted_claim_id": from_claim.id,
        "rejected_claim_id": to_claim.id,
    })

    assert resolve_resp.status_code == 400
    assert "Evidence" in resolve_resp.json()["detail"]

    await db_session.refresh(from_claim)
    await db_session.refresh(to_claim)
    assert from_claim.status == "conflicting"
    assert from_claim.adopted is False
    assert to_claim.status == "conflicting"
    assert to_claim.adopted is False


@pytest.mark.asyncio
async def test_resolve_conflict_rejects_claim_ids_outside_relation(client: AsyncClient, db_session: AsyncSession):
    topic, from_claim, _, conflict = await _create_conflict_fixture(db_session)
    unrelated_claim = ResearchClaim(
        topic_id=topic.id,
        user_id=1,
        claim_text="不属于这条冲突关系的事实。",
        status="pending",
        confidence=70,
        adopted=False,
    )
    db_session.add(unrelated_claim)
    await db_session.commit()
    await db_session.refresh(unrelated_claim)

    resolve_resp = await client.post(f"/api/v1/research/conflicts/{conflict.id}/resolve", json={
        "accepted_claim_id": from_claim.id,
        "rejected_claim_id": unrelated_claim.id,
    })

    assert resolve_resp.status_code == 400
    assert "Accepted and rejected claims" in resolve_resp.json()["detail"]


@pytest.mark.asyncio
async def test_other_user_cannot_resolve_research_conflict(client: AsyncClient, db_session: AsyncSession):
    _, from_claim, to_claim, conflict = await _create_conflict_fixture(db_session)
    other = User(username="conflict-other", password_hash="mock")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    previous_override = app.dependency_overrides[get_current_user]

    async def override_other_user():
        return other

    app.dependency_overrides[get_current_user] = override_other_user
    try:
        resolve_resp = await client.post(f"/api/v1/research/conflicts/{conflict.id}/resolve", json={
            "accepted_claim_id": from_claim.id,
            "rejected_claim_id": to_claim.id,
        })
    finally:
        app.dependency_overrides[get_current_user] = previous_override

    assert resolve_resp.status_code == 404
