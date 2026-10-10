import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // どのテストも、PGlite を起動してマイグレーションを全部流してから始まる。
    // CI では、これが既定の5秒を超えることがある（各ファイルの最初のテストが時間切れで落ちた）
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
