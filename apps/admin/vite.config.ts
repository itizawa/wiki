import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = process.env.API_ORIGIN ?? "http://localhost:8787";

// 管理画面とAPIを同一オリジン（/api）に見せる。Cookie（SameSite=Lax）とCSRF検査のため
const proxy = {
  "/api": {
    target: apiTarget,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
    // APIのCSRF検査は Origin を見るので、ブラウザの Origin をそのまま渡す
    changeOrigin: false,
  },
  // アップロードした画像。本文には /images/{name} と書くので、そのパスのまま API へ渡す
  "/images": { target: apiTarget },
};

export default defineConfig({
  plugins: [
    react(),
    // ホーム画面に置けるようにする（PWA）。Service Worker は `pnpm build` したものにだけ入り、`pnpm dev` では動かない
    VitePWA({
      // 新しい版は勝手に切り替えない。画面に知らせを出し、本人が選んだときに切り替える（src/components/UpdatePrompt.tsx）
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "wiki 管理画面",
        short_name: "wiki 管理",
        description: "wiki のページを書き、承認し、公開する",
        lang: "ja",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#ffffff",
        background_color: "#f6f7f9",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // 覚えておくのはビルドした画面のファイルだけ。API の応答やアップロードした画像は覚えない（実行時のキャッシュは置かない）
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        cleanupOutdatedCaches: true,
        // 画面の JS は1ファイルで 1.6MB ある。既定の上限（2MB）を超えると黙って覚える対象から外れるので、上げておく
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "/index.html",
        // Worker が先に受ける経路（apps/api/wrangler.toml の run_worker_first）は、画面遷移でも index.html を返さない。
        // 外すと、Google ログイン（/api/auth/google/login とコールバック）が画面に戻されて通らなくなる
        navigateFallbackDenylist: [/^\/api\//, /^\/export\//, /^\/internal\//, /^\/images\//, /^\/health$/],
      },
    }),
  ],
  server: { port: 5173, proxy },
  // ビルドしたもの（Service Worker 入り）を手元で確かめるとき用
  preview: { port: 4173, proxy },
});
