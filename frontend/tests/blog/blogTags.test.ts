import { describe, expect, it } from "vitest";
import { getBlogTagStyle, splitBlogTags } from "../../src/features/blog/utils/blogTags";

describe("splitBlogTags", () => {
  it("按英文逗号分割并 trim", () => {
    expect(splitBlogTags("react,  ts ,css")).toEqual(["react", "ts", "css"]);
  });

  it("支持中文逗号", () => {
    expect(splitBlogTags("前端，后端，运维")).toEqual(["前端", "后端", "运维"]);
  });

  it("空字符串返回空数组", () => {
    expect(splitBlogTags("")).toEqual([]);
    expect(splitBlogTags(undefined)).toEqual([]);
  });

  it("limit 截断", () => {
    expect(splitBlogTags("a,b,c,d", 2)).toEqual(["a", "b"]);
  });
});

describe("getBlogTagStyle 颜色稳定性", () => {
  it("同一标签两次返回完全相同的样式", () => {
    const a = getBlogTagStyle("前端");
    const b = getBlogTagStyle("前端");
    expect(a).toEqual(b);
  });

  it("返回 hsl 颜色且带半透明背景", () => {
    const style = getBlogTagStyle("react");
    expect(style.backgroundColor).toMatch(/^hsl\(/);
    expect(style.borderColor).toMatch(/^hsl\(/);
    expect(style.color).toMatch(/^hsl\(/);
    // 背景一定是 0.12 透明度
    expect(style.backgroundColor).toContain("/ 0.12)");
  });

  it("不同标签可能得到不同颜色（覆盖 10 种 hue 的存在）", () => {
    const tags = ["react", "vue", "angular", "svelte", "solid", "qwik", "lit", "astro", "next", "nuxt"];
    const hues = new Set(
      tags.map((t) => {
        const m = getBlogTagStyle(t).backgroundColor.match(/hsl\((\d+)/);
        return m ? m[1] : "";
      }),
    );
    // 至少能命中 3 种以上不同 hue（宽松断言，避免哈希分布偶发碰撞）
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });
});
