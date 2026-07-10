from pathlib import Path
from pydantic_settings import BaseSettings

# 项目根目录（backend/），所有数据路径基于此绝对路径，不依赖 cwd
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    openai_api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model_name: str = "Qwen3.6-35B"
    database_url: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'ai-blog.db').as_posix()}"
    chroma_db_path: str = str(DATA_DIR / "chroma_db")
    embedding_model: str = "Qwen3-Embedding-8B"
    embedding_base_url: str | None = "https://dygptapi.duoyioa.com/openai/v1"
    embedding_api_key: str | None = None
    embedding_batch_size: int = 32
    rag_top_k: int = 3
    rag_distance_threshold: float = 0.7
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
    # 三档思考模式: fast(快速) / balanced(平衡) / smart(智能)
    smart_thinking_model_name: str | None = None
    fast_temperature: float = 0.9
    fast_max_output_tokens: int = 2048
    balanced_temperature: float = 0.7
    balanced_max_output_tokens: int = 4096
    smart_temperature: float = 0.2
    smart_max_output_tokens: int = 8192
    fast_extra_body: str | None = None
    balanced_extra_body: str | None = None
    smart_extra_body: str | None = None
    mcp_call_timeout_seconds: float = 30.0
    # 思考模型思考阶段可能长时间不产生 event,这里给两个兜底:
    # 1. langchain 内部 stream_chunk_timeout 调大,避免思考期间被误判卡死后异常被 astream_events 吞掉
    # 2. 我们自己的 agent_stream_idle_timeout 作为最终兜底,N 秒无 event 主动 raise 让上层正常收尾
    langchain_stream_chunk_timeout: float | None = 600.0
    agent_stream_idle_timeout: float = 600.0

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

