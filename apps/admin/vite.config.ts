import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { APP_SHELL_URL, precacheAppShellAtRoot } from "./build/appShell";
import { firstLoadProblem, type Chunk } from "./build/firstLoad";

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
  // MCP が受け取る、署名つきの音声の URL
  "/audio": { target: apiTarget },
  // 外部のアプリ（MCP クライアント）が呼ぶ経路。本番と同じく、プレフィックス無しで同じオリジンに出す
  "/oauth": { target: apiTarget, changeOrigin: false },
  "/.well-known/oauth-": { target: apiTarget, changeOrigin: false },
  "/mcp": { target: apiTarget, changeOrigin: false },
};

// エディタ（TipTap・ProseMirror・コードの色づけ）と、それだけが使うライブラリ
const EDITOR_PACKAGES = /^(@tiptap\/.+|prosemirror-.+|lowlight|highlight\.js|linkifyjs|marked|@floating-ui\/.+|fast-equals|rope-sequence|orderedmap|w3c-keyname)$/;
// MUI と、それだけが使うライブラリ
const MUI_PACKAGES = /^(@mui\/.+|@emotion\/.+|@popperjs\/core|stylis|react-transition-group|clsx|hoist-non-react-statics|react-is|@babel\/runtime)$/;
// use-sync-external-store は、エディタ（@tiptap/react）も、最初に読む側（TanStack）も使う。どこにも入れないと editor に寄せられ、最初に editor を読むことになる
const REACT_PACKAGES = /^(react|react-dom|scheduler|use-sync-external-store)$/;

export default defineConfig({
  plugins: [
    react(),
    // エディタが最初に読む JS に戻っていたら、ビルドを止める（気づかないまま、最初の表示が重くなるのを防ぐ）
    {
      name: "wiki:first-load",
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter((file): file is typeof file & Chunk => file.type === "chunk");
        const problem = firstLoadProblem(chunks, ["editor"]);
        if (problem) this.error(problem);
      },
    },
    // ホーム画面に置けるようにする（PWA）。Service Worker は `pnpm build` したものにだけ入り、`pnpm dev` では動かない
    VitePWA({
      // 新しい版は勝手に切り替えない。画面に知らせを出し、本人が選んだときに切り替える（src/components/UpdatePrompt.tsx）
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "wiki 管理画面",
        short_name: "wiki 管理",
        description: "wiki のページを書き、公開する",
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
        // 画面の JS は分けてある（下の manualChunks と、src/router.tsx の lazyScreen）が、分けたファイルも全部覚える（オフラインでも画面を開けるように）。
        // 既定の上限（2MB）を超えたファイルは黙って覚える対象から外れ、その画面だけオフラインで開けなくなるので、上げておく
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 画面遷移には、覚えておいた / を返す。/index.html にしない理由は build/appShell.ts
        navigateFallback: APP_SHELL_URL,
        manifestTransforms: [precacheAppShellAtRoot],
        // Worker が先に受ける経路（apps/api/wrangler.toml の run_worker_first）は、画面遷移でも index.html を返さない。
        // 外すと、Google ログイン（/api/auth/google/login とコールバック）や、外部のアプリの認可（/oauth/authorize）が画面に戻されて通らなくなる
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/export\//,
          /^\/internal\//,
          /^\/images\//,
          /^\/audio\//,
          /^\/health$/,
          /^\/oauth\//,
          /^\/\.well-known\//,
          /^\/mcp$/,
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // ライブラリを、アプリのコードとは別のファイルに分ける。アプリだけを直した版では、ライブラリのファイルは名前（ハッシュ）が変わらず、取り直さずに済む。
        // editor は、エディタを使う画面を開くときだけ読む（最初に読む JS に入ると、上の wiki:first-load がビルドを止める）。
        // react を分けるのは、mui が react を使うため（アプリ本体に残すと、本体と mui が互いを読み合う形になる）
        manualChunks(id) {
          const name = id.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
          if (!name) return;
          if (EDITOR_PACKAGES.test(name)) return "editor";
          if (MUI_PACKAGES.test(name)) return "mui";
          if (REACT_PACKAGES.test(name)) return "react";
        },
      },
    },
  },
  server: { port: 5173, proxy },
  // ビルドしたもの（Service Worker 入り）を手元で確かめるとき用
  preview: { port: 4173, proxy },
});
