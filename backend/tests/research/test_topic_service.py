"""research/topic CRUD 单元测试。

锁住主题的创建/列表（排除 archived 与他人）/详情（聚合子集合）/更新/归档/物理删除，
及归属隔离（他人操作返回 None/False）。
"""


from src.services.research.topic import (
    archive_topic,
    create_topic,
    delete_topic,
    get_topic_detail,
    list_topics,
    update_topic,
)


async def test_create_topic(db_session) -> None:
    summary = await create_topic(db_session, {"title": "T1", "description": "D"}, user_id=1)
    assert summary["title"] == "T1"
    assert summary["status"] == "draft"
    assert summary["id"] > 0


async def test_list_topics_excludes_archived_and_other_user(db_session, make_topic) -> None:
    await make_topic(user_id=1, title="A")
    await make_topic(user_id=2, title="B")
    await make_topic(user_id=1, title="C", status="archived")
    topics = await list_topics(db_session, user_id=1)
    titles = {t["title"] for t in topics}
    assert titles == {"A"}


async def test_get_topic_detail_aggregates_children(db_session, make_topic, make_source) -> None:
    topic = await make_topic(user_id=1)
    await make_source(topic)
    detail = await get_topic_detail(db_session, topic.id, user_id=1)
    assert detail is not None
    assert detail["title"] == "测试主题"
    assert len(detail["sources"]) == 1
    assert detail["evidence"] == []


async def test_get_topic_detail_other_user_none(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1)
    assert await get_topic_detail(db_session, topic.id, user_id=2) is None


async def test_update_topic(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1, title="Old")
    summary = await update_topic(db_session, topic.id, {"title": "New", "status": "active"}, user_id=1)
    assert summary["title"] == "New"
    assert summary["status"] == "active"


async def test_update_topic_other_user_none(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1)
    assert await update_topic(db_session, topic.id, {"title": "X"}, user_id=2) is None


async def test_archive_topic_hides_from_list(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1)
    assert await archive_topic(db_session, topic.id, user_id=1) is True
    topics = await list_topics(db_session, user_id=1)
    assert all(t["id"] != topic.id for t in topics)


async def test_archive_topic_other_user_false(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1)
    assert await archive_topic(db_session, topic.id, user_id=2) is False


async def test_delete_topic(db_session, make_topic) -> None:
    topic = await make_topic(user_id=1)
    assert await delete_topic(db_session, topic.id, user_id=1) is True
    assert await get_topic_detail(db_session, topic.id, user_id=1) is None


async def test_delete_topic_not_found_false(db_session) -> None:
    assert await delete_topic(db_session, 9999, user_id=1) is False
