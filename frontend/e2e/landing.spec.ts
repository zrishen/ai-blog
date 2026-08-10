import { test, expect } from "@playwright/test";

// 落地页与路由的纯前端行为，不依赖后端 API。

test.describe("落地页与路由", () => {
  test("首页渲染标题与品牌", async ({ page }) => {
    await page.goto("/");

    // hero 主标题
    await expect(
      page.getByRole("heading", { level: 1, name: /把零散的想法/ }),
    ).toBeVisible();

    // 品牌标识
    await expect(page.getByText("AI Blog").first()).toBeVisible();

    // 主 CTA 可见
    await expect(
      page.getByRole("link", { name: /进入创作空间/ }),
    ).toBeVisible();
  });

  test("未知路由回退到首页", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");

    // App.tsx 的 catch-all：<Route path="*" element={<Navigate to="/" replace />} />
    await expect(page).toHaveURL(/\/$/);

    // 落地到首页后，hero 仍可见
    await expect(
      page.getByRole("heading", { level: 1, name: /把零散的想法/ }),
    ).toBeVisible();
  });
});
