import json
import logging

import pytest
from httpx import AsyncClient

from src.logging_config import _RequestIdFilter, _json_formatter


def test_json_formatter_outputs_searchable_fields():
    record = logging.LogRecord(
        name="src.test",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="event user_id=%s",
        args=(7,),
        exc_info=None,
    )
    _RequestIdFilter().filter(record)

    data = json.loads(_json_formatter().format(record))

    assert data["level"] == "WARNING"
    assert data["logger"] == "src.test"
    assert data["message"] == "event user_id=7"
    assert data["request_id"] == "-"
    assert data["timestamp"]


@pytest.mark.asyncio
async def test_api_requests_are_logged(client: AsyncClient, caplog):
    caplog.set_level(logging.INFO, logger="http.access")

    response = await client.get("/api/v1/status")

    assert response.status_code == 200
    assert "GET /api/v1/status 200" in caplog.text
    assert "ip=" in caplog.text
