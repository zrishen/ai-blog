import { test, expect } from "@playwright/test";

// 登录通过 Dialog（不是独立 /login 路由）。未登录时点击落地页 CTA 应弹出登录表单。
// 仅校验表单渲染，不提交（提交才会打 /api/v1/auth/login）。

test.describe("登录弹窗", () => {
  test("从落地页 CTA 打开登录表单", async ({ page }) => {
    await page.goto("/");

    // 未登录态点击「打开工作台」会 preventDefault 并打开登录弹窗
    await page.getByRole("link", { name: /打开工作台/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "登录到 AI Blog" }),
    ).toBeVisible();

    // 用户名 / 密码输入框可见（通过关联 label 定位，避开易变 CSS）
    await expect(dialog.getByLabel("用户名")).toBeVisible();
    await expect(dialog.getByLabel("密码")).toBeVisible();

    // 登录方式切换 Tab 存在（role=tab，区别于提交按钮的 role=button）
    await expect(dialog.getByRole("tab", { name: "注册" })).toBeVisible();

    // 提交按钮可见（登录态文案为「登录」）
    await expect(
      dialog.getByRole("button", { name: "登录" }),
    ).toBeVisible();
  });
});
