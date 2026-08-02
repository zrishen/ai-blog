"""大脑认知记忆系统（FalkorDB）：记忆图谱 + 抽取/巩固/衰减 + 时序 recall。

业务数据在 PostgreSQL；认知产物（概念/记忆/关系/向量）在 FalkorDB graph `cortex`。
RAG = 大脑 recall（向量召回 + 时序过滤 + 图扩展 + 置信度加权）。
"""
