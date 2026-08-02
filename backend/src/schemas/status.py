from pydantic import BaseModel


class StatusComponents(BaseModel):
    database: str
    uploads: str
    vector_store: str
    brain: str = "disabled"  # AI 大脑（FalkorDB）；memory_enabled=False 时 disabled


class StatusResponse(BaseModel):
    status: str
    model: str
    timestamp: str
    components: StatusComponents
