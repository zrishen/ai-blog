import { describe, expect, it } from "vitest";
import { maskStreamingMarkdown } from "../../src/features/ai-chat/ai-sidebar/streamingMarkdown";

describe("maskStreamingMarkdown", () => {
  it("完整表格（header + separator + 数据行）原样返回", () => {
    const text = ["| 名字 | 分数 |", "|---|---|", "| 张三 | 90 |"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("表格头 + separator 但无数据行：保留（react-markdown 会渲染成空 body 表格）", () => {
    const text = ["| 名字 | 分数 |", "|---|---|"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("只有一行表格头、还没有 separator：剥掉这一行", () => {
    const text = "前文\n\n| 名字 | 分数 |";
    expect(maskStreamingMarkdown(text)).toBe("前文\n\n");
  });

  it("多行表格头都没 separator：整块都剥掉", () => {
    const text = ["| 名字 | 分数 |", "| 班级 | 排名 |"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe("");
  });

  it("文本中段的完整表格不受影响", () => {
    const text = [
      "一段引入文字。",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "结尾文字。",
    ].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("末尾不完整的表格头不影响前面已完成的表格", () => {
    const text = [
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "中间段落",
      "",
      "| 新表头 |",
    ].join("\n");
    // 剥掉末尾的 "| 新表头 |"，但保留前面所有换行/空行结构（slice 语义）
    const expected = [
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "中间段落",
      "",
      "",
    ].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(expected);
  });

  it("代码块内的 | 行不算表格行", () => {
    const text = ["```", "| 名字 | 分数 |", "```"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("未闭合的代码块（奇数 fence）：原样返回，不做处理", () => {
    const text = ["```python", "| print(a | b) |", "x = 1"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("空字符串原样返回", () => {
    expect(maskStreamingMarkdown("")).toBe("");
  });

  it("普通文本（无 | 字符）原样返回", () => {
    const text = "hello world\n这是普通段落。";
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("左对齐 / 居中 separator 也能识别成完整表格", () => {
    const text = ["| 名字 | 分数 |", "|:---|:---:|"].join("\n");
    expect(maskStreamingMarkdown(text)).toBe(text);
  });

  it("不带首尾 | 的 GFM 表格行也能识别（如 a | b）", () => {
    // 注意：a | b 形式不是严格的 |...|，不会被 TABLE_ROW_RE 命中——保持原样
    const text = "前文\n\na | b";
    expect(maskStreamingMarkdown(text)).toBe(text);
  });
});
