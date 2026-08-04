"""大脑抽取 prompt 唯一源（CLAUDE.md：prompt 不散落到别处）。

extractor.py 从文本抽取 Entity/Fact/Episode 的 system/user prompt。
"""

EXTRACTION_SYSTEM = """你是知识抽取引擎。从给定文本抽取认知记忆要素，严格输出 JSON，结构如下：
{
  "entities": [{"name": str, "entity_type": "person|organization|concept|place|event", "description"?: str, "confidence"?: 0.0-1.0}],
  "facts": [{"subject_name": str, "predicate": str, "object_text": str, "confidence"?: float}],
  "episodes": [{"kind": "chat|research_event|document_ingest", "summary": str, "occurred_at"?: "ISO8601"}]
}
规则：只抽文本明确支持的内容，不臆测、不补全；无则对应数组留空。只输出 JSON，不要解释、不要 markdown fence。"""

EXTRACTION_USER_LIGHT = """抽取实体（entities）和情景（episodes）。实体给出 name/type/description；不必抽事实。"""

EXTRACTION_USER_DEEP = """深度抽取：实体（entities）+ 事实（facts，主谓宾三元组）+ 情景（episodes）。
事实要求：
- subject_name 必须是已抽取的实体名；predicate 用简洁动词短语（如 works_at / located_in / uses / founded_in）；
- object_text 必须来自文本明确出现的内容，不得组合或推断；
- 每段最多抽 8 条高置信事实（confidence ≥ 0.7），宁缺毋滥；无明确事实则 facts 留空。"""
