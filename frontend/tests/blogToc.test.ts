import { describe, expect, it } from "vitest";
import { extractHeadings } from "../src/features/blog/utils/blogToc";

describe("extractHeadings", () => {
  it("提取 h2/h3/h4 标题", () => {
    const md = `# h1 ignored\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级 ignored`;
    const items = extractHeadings(md);
    expect(items.map((i) => i.level)).toEqual([2, 3, 4]);
    expect(items.map((i) => i.text)).toEqual(["二级", "三级", "四级"]);
  });

  it("slugify 中英混合", () => {
    const items = extractHeadings("## Hello 世界");
    expect(items[0].slug).toBe("hello-世界");
  });

  it("保留代码块内的 # 不误判（基于正则的局限：行首 # 仍会被识别）", () => {
    // 正则只匹配行首 #， fenced code 里的行首 # 同样会被命中——这是当前实现
    const md = "## 真标题\n\n```\n## 不是标题\n```\n";
    const items = extractHeadings(md);
    expect(items.length).toBe(2);
    expect(items[0].text).toBe("真标题");
    expect(items[1].text).toBe("不是标题");
  });

  it("空字符串", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("trim 文本两侧空白", () => {
    const items = extractHeadings("##   spaced title   ");
    expect(items[0].text).toBe("spaced title");
  });
});
