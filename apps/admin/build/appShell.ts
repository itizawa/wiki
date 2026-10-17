import type { ManifestTransform } from "workbox-build";

// 画面遷移（深い URL の直開き・再読み込み）に Service Worker が返す HTML の URL（vite.config.ts の navigateFallback）。
// /index.html にしない。本番（Cloudflare Workers の静的アセット）は /index.html を 307 で / に送り、
// Service Worker がキャッシュを引けずにネットワークへ取りに行ったとき、転送を経た応答を画面遷移に返すことになる。
// Chrome はそれを受け付けず、画面が ERR_FAILED になる（issue #476）。/ なら転送されずに 200 が返る
export const APP_SHELL_URL = "/";

const BUILT_HTML = "index.html";

// ビルドした index.html を、/ という URL で覚えさせる（Service Worker は覚えた URL でしか navigateFallback を引けない）
export const precacheAppShellAtRoot: ManifestTransform = (entries) => {
  if (!entries.some((entry) => entry.url === BUILT_HTML)) {
    // 無いまま進むと、Service Worker が起動時に navigateFallback の URL を引けずに止まる
    throw new Error(`覚えるファイルに ${BUILT_HTML} がありません。navigateFallback（${APP_SHELL_URL}）に使えません`);
  }
  return {
    manifest: entries.map((entry) => (entry.url === BUILT_HTML ? { ...entry, url: APP_SHELL_URL } : entry)),
    warnings: [],
  };
};
