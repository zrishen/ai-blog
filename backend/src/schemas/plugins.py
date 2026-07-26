"""平台插件 API 的输入输出模型。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


PluginTransport = Literal["stdio", "streamable-http"]
PluginPermissionLevel = Literal["read", "write"]


class PluginEnabledRequest(BaseModel):
    is_enabled: bool

    model_config = ConfigDict(extra="forbid")


class UserPluginResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    icon: str
    permission_level: PluginPermissionLevel
    tool_count: int
    is_enabled: bool


class UserPluginListResponse(BaseModel):
    plugins: list[UserPluginResponse]


class AdminPluginCreate(BaseModel):
    slug: Annotated[str, Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9-]*$")]
    name: Annotated[str, Field(min_length=1, max_length=100)]
    description: Annotated[str, Field(max_length=1000)] = ""
    icon: Annotated[str, Field(min_length=1, max_length=40)] = "Blocks"
    transport: PluginTransport
    command: Annotated[str | None, Field(max_length=1000)] = None
    args: list[Annotated[str, Field(max_length=1000)]] = Field(default_factory=list, max_length=100)
    env_vars: dict[Annotated[str, Field(min_length=1, max_length=100)], Annotated[str, Field(max_length=5000)]] = Field(default_factory=dict, max_length=100)
    url: HttpUrl | None = None
    permission_level: PluginPermissionLevel = "read"
    is_published: bool = False

    @model_validator(mode="after")
    def validate_transport_config(self):
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio 插件必须提供 command")
        if self.transport == "stdio" and self.url is not None:
            raise ValueError("stdio 插件不能提供 url")
        if self.transport == "streamable-http" and self.url is None:
            raise ValueError("streamable-http 插件必须提供 url")
        if self.transport == "streamable-http" and self.command:
            raise ValueError("streamable-http 插件不能提供 command")
        return self


class AdminPluginUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    description: Annotated[str, Field(max_length=1000)] | None = None
    icon: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    command: Annotated[str, Field(max_length=1000)] | None = None
    args: list[Annotated[str, Field(max_length=1000)]] | None = Field(default=None, max_length=100)
    env_vars: dict[Annotated[str, Field(min_length=1, max_length=100)], Annotated[str, Field(max_length=5000)]] | None = Field(default=None, max_length=100)
    url: HttpUrl | None = None
    permission_level: PluginPermissionLevel | None = None
    is_published: bool | None = None

    @field_validator("url", mode="before")
    @classmethod
    def blank_url_is_none(cls, value):
        return None if value == "" else value


class AdminPluginPublishRequest(BaseModel):
    is_published: bool


class AdminPluginResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    icon: str
    transport: PluginTransport
    command: str | None = None
    args: list[str]
    has_env_vars: bool
    url: str | None = None
    tools: list[dict]
    permission_level: PluginPermissionLevel
    is_published: bool
    created_at: str | None = None
    updated_at: str | None = None


class AdminPluginListResponse(BaseModel):
    plugins: list[AdminPluginResponse]
