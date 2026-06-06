from pydantic import BaseModel


class StatusComponents(BaseModel):
    database: str
    uploads: str
    vector_store: str


class StatusResponse(BaseModel):
    status: str
    model: str
    timestamp: str
    components: StatusComponents
