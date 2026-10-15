import { expect, test } from "@playwright/test";

test("ページを作り、タイトルと本文を入れると、すべてのページの一覧に出る", async ({ page }) => {
  // DB は実行をまたいで残るので、ほかの回のページと見分けがつくタイトルにする
  const title = `E2E のページ ${Date.now()}`;
  const body = "E2E で書いた本文";

  await page.goto("/");
  await page.getByRole("button", { name: "開発用ログイン" }).click();
  await expect(page).toHaveURL(/\/w\/wiki$/);

  // 「＋」はマウスが乗っている間だけ見えるので、見出しに乗せてから押す
  await page.getByText("ドキュメント", { exact: true }).hover();
  await page.getByRole("button", { name: "最上位に新しいページ" }).click();
  await expect(page).toHaveURL(/\/w\/wiki\/pages\/[^/]+$/);

  const titleInput = page.getByRole("textbox", { name: "タイトル" });
  await titleInput.fill(title);
  // タイトルで Enter を押すと、本文の先頭へ移る
  await titleInput.press("Enter");
  await page.keyboard.type(body);
  // 打つのが止まると下書きとして保存される（「保存中…」のあと「保存済み」）
  await expect(page.getByText("保存済み")).toBeVisible();

  await page.getByRole("link", { name: "すべてのページ" }).click();
  await expect(page).toHaveURL(/\/w\/wiki\/pages$/);
  const row = page.getByRole("link", { name: title });
  await expect(row).toBeVisible();

  // 開き直しても、入れたタイトルと本文が残っている
  await row.click();
  await expect(page.getByRole("textbox", { name: "タイトル" })).toHaveValue(title);
  await expect(page.getByText(body)).toBeVisible();
});
