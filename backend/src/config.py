from pathlib import Path
from pydantic_settings import BaseSettings

# 项目根目录（backend/），所有数据路径基于此绝对路径，不依赖 cwd
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    openai_api_key: str
    base_url: str
    model_name: str = "Qwen3.6-35B"
    database_url: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'ai-blog.db').as_posix()}"
    max_memory_tokens: int = 4096
    memory_compact_threshold: int = 2000
    chroma_db_path: str = str(DATA_DIR / "chroma_db")
    embedding_provider: str = "onnx"
    embedding_model: str = "Qwen3-Embedding-8B"
    embedding_base_url: str | None = "https://dygptapi.duoyioa.com/openai/v1"
    embedding_api_key: str | None = None
    embedding_batch_size: int = 32
    embedding_dim: int = 384
    rag_top_k: int = 3
    rag_distance_threshold: float = 0.7
    router_model_name: str = "ds/deepseek-v4-flash"
    router_enabled: bool = True
    jwt_secret: str = "dev-secret-key-change-in-production-env"
    jwt_expire_seconds: int = 7 * 24 * 3600
    blog_content_dir: str = str(DATA_DIR / "content" / "blog")
    upload_dir: str = str(DATA_DIR / "content" / "uploads")
    image_generation_model: str = "gpt-image-1"
    image_generation_size: str = "1536x1024"
    public_chat_max_input_chars: int = 2000
    public_chat_max_context_chars: int = 6000
    public_chat_max_history_messages: int = 10
    public_chat_max_output_tokens: int = 800
    model_temperature: float = 0.7
    model_max_output_tokens: int | None = None
    deep_thinking_model_name: str | None = None
    deep_thinking_temperature: float = 0.3
    deep_thinking_max_output_tokens: int = 8192
    fast_answer_extra_body: str | None = None
    deep_thinking_extra_body: str | None = None
    mcp_call_timeout_seconds: float = 30.0

    class Config:
        env_file = ".env"


settings = Settings()

