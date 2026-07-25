"""MCP 服务器配置模型。"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow


class MCPServer(Base):
    __tablename__ = "mcp_servers"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_mcp_servers_user_name"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, default=1, index=True)
    name = Column(String(100), nullable=False)
    server_type = Column(String(20), nullable=False)
    tools = Column(JSON, nullable=True)
    command = Column(Text, nullable=True)
    args = Column(Text, nullable=True)
    env_vars = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
