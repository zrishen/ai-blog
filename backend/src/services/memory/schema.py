"""大脑认知模型 schema 常量：节点 label、边 type、枚举。

节点（知识层）: Entity / Fact / Episode / Preference / Document
节点（原文层）: Chunk（向量检索，不建图谱边）
边: RELATES_TO / SUBJECT|OBJECT / INVOLVES / MENTIONS / SOURCES / SUPERSEDES / SAME_AS
"""

# ---- 节点 label ----
ENTITY = "Entity"          # 语义记忆：人/组织/概念/地点
FACT = "Fact"              # 时序事实：subject+predicate+object + valid_from/to + confidence
EPISODE = "Episode"        # 情景记忆：一次对话/事件 + occurred_at
PREFERENCE = "Preference"  # 程序记忆：用户偏好/习惯
CHUNK = "Chunk"            # 原文层：向量检索，不建图谱边
DOCUMENT = "Document"      # 来源锚点：指向 PG 业务数据

# ---- 边 type ----
RELATES_TO = "RELATES_TO"  # Entity-[relation]->Entity（带时效 valid_from/to + weight）
SUBJECT = "SUBJECT"        # Fact -> Entity（主语）
OBJECT = "OBJECT"          # Fact -> Entity（宾语）
INVOLVES = "INVOLVES"      # Episode -> Entity/Fact
MENTIONS = "MENTIONS"      # Chunk -> Entity（召回原文跳实体的锚定边）
SOURCES = "SOURCES"        # Document -> Fact/Entity（知识出处）
SUPERSEDES = "SUPERSEDES"  # 新 Fact -> 旧 Fact（事实演化，旧 Fact valid_to 置位）
SAME_AS = "SAME_AS"        # Entity -> Entity（消歧/合并）

# ---- Episode kind ----
EPISODE_CHAT = "chat"
EPISODE_RESEARCH = "research_event"
EPISODE_INGEST = "document_ingest"

# ---- Fact kind（抽取的事实类型，可选语义细分）----
FACT_ATTRIBUTE = "attribute"   # 实体属性事实
FACT_RELATION = "relation"     # 关系事实
FACT_EVENT = "event"           # 事件事实

# 向量 index 命名前缀（按 embedding model slug 隔离维度）
VECTOR_INDEX_PREFIX = "vec_idx"


def vector_index_name(embedding_model_slug: str) -> str:
    """按 embedding 模型 slug 生成 vector index 名（维度隔离）。"""
    slug = embedding_model_slug.replace("-", "_").replace(".", "_")
    return f"{VECTOR_INDEX_PREFIX}_{slug}"
