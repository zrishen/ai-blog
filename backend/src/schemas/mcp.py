from pydantic import BaseModel


class MCPServerCreate(BaseModel):
    name: str
    server_type: str  # "stdio" | "streamable-http"
    command: str | None = None
    args: list[str] | None = None
    env_vars: dict[str, str] | None = None
    url: str | None = None


class MCPServerResponse(BaseModel):
    id: int
    name: str
    server_type: str
    tools: list[str] | None = None
    tools_detail: list[dict] | None = None
    command: str | None = None
    args: list[str] | None = None
    env_vars: dict[str, str] | None = None
    url: str | None = None
    is_active: bool
    created_at: str | None = None

    model_config = {"from_attributes": True}


class MCPServerListResponse(BaseModel):
    servers: list[MCPServerResponse]


class MCPServerToggleRequest(BaseModel):
    is_active: bool
