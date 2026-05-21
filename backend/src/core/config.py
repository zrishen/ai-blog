from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str
    base_url: str
    model_name: str = "Qwen3.6-35B"
    database_url: str = "sqlite+aiosqlite:///./ai_assistant.db"
    max_memory_tokens: int = 4096
    memory_compact_threshold: int = 2000
    chroma_db_path: str = "./chroma_db"
    embedding_model: str = "text-embedding-3-small"
    embedding_base_url: str | None = None
    embedding_dim: int = 384
    rag_top_k: int = 3

    class Config:
        env_file = ".env"


settings = Settings()
