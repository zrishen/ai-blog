import { test, expect } from "@playwright/test";

// 主题切换：NavBar 的 toggle 会写 localStorage['theme'] 并设 <html data-theme>。
// 不打后端 API。/workspace 的 NavBar 在 auth 初始化（refresh 失败回落未登录）后渲染。

test.describe("主题切换", () => {
  test("切换主题并持久化到 localStorage", async ({ page }) => {
    // 在应用脚本执行前固定初始主题为 light，确保断言起点确定
    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");
    });

    await page.goto("/workspace");

    // NavBar 渲染后主题按钮可见（title 提供 accessible name）
    const toggle = page.getByRole("button", { name: "切换主题" });
    await expect(toggle).toBeVisible({ timeout: 10000 });

    // 初始 light
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // 切到 dark
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // 已持久化
    const stored = await page.evaluate(() => localStorage.getItem("theme"));
    expect(stored).toBe("dark");
  });
});
