import { expect, test } from "@playwright/test";

test("開発用ログインで入ると、最初の wiki のダッシュボードが開く", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "開発用ログイン" }).click();

  await expect(page).toHaveURL(/\/w\/wiki$/);
  // 左下のユーザーメニューに、ログインした人が出る
  await expect(page.getByText("e2e@example.com")).toBeVisible();
});
