from src.tools.mcp import normalize_mcp_capabilities


def test_only_published_plugin_capabilities_are_exposed_to_agent():
    capabilities = normalize_mcp_capabilities([
        {
            "id": 1,
            "slug": "enabled-search",
            "name": "Search",
            "is_published": True,
            "tools": [{"name": "search", "input_schema": {"type": "object"}}],
        },
        {
            "id": 2,
            "slug": "unpublished-shell",
            "name": "Shell",
            "is_published": False,
            "tools": [{"name": "run", "input_schema": {"type": "object"}}],
        },
    ])

    assert [item["tool_ref"] for item in capabilities] == ["enabled-search/search"]
