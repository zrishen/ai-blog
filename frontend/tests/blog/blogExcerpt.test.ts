import { describe, expect, it } from "vitest";
import { generateExcerpt } from "../../src/features/blog/utils/blogExcerpt";

describe("generateExcerpt", () => {
  it("空字符串返回空串", () => {
    expect(generateExcerpt("")).toBe("");
  });

  it("剥除 h2/h3 标题行", () => {
    const md = "## 标题\n\n## 另一个\n\n保留这段正文";
    expect(generateExcerpt(md)).toBe("保留这段正文");
  });

  it("剥除图片与链接（含链接文本）", () => {
    const md = "![alt](http://x.png) 与 [Anthropic](https://www.anthropic.com) 文本";
    // 源码用 /\[[^\]]*\]\([^)]*\)/g 把整个 [text](url) 全部剥掉
    expect(generateExcerpt(md)).toBe("与 文本");
  });

  it("剥除 # 标题行", () => {
    const md = "# h1 标题\n## h2 标题\n保留这段正文";
    // 源码只剥 # 开头（h1 由 ^#+\s 匹配，会剥掉整行；h2 也剥掉整行）
    expect(generateExcerpt(md)).toBe("保留这段正文");
  });

  it("超过 128 字符在末尾追加 …", () => {
    const long = "a".repeat(200);
    const out = generateExcerpt(long);
    expect(out.length).toBe(129); // 128 + …
    expect(out.endsWith("…")).toBe(true);
  });

  it("恰好 128 字符不截断", () => {
    const exact = "a".repeat(128);
    expect(generateExcerpt(exact)).toBe(exact);
  });

  it("多空白折叠为单个空格", () => {
    const md = "a\n\n\n   b\t\tc";
    expect(generateExcerpt(md)).toBe("a b c");
  });
});
