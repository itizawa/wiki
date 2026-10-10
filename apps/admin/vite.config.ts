import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_ORIGIN ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 管理画面とAPIを同一オリジン（/api）に見せる。Cookie（SameSite=Lax）とCSRF検査のため
    proxy: {
      "/api": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ""),
        // APIのCSRF検査は Origin を見るので、ブラウザの Origin をそのまま渡す
        changeOrigin: false,
      },
      // 外部のアプリ（MCP クライアント）が呼ぶ経路。本番と同じく、プレフィックス無しで同じオリジンに出す
      "/oauth": { target: apiTarget, changeOrigin: false },
      "/.well-known/oauth-": { target: apiTarget, changeOrigin: false },
      "/mcp": { target: apiTarget, changeOrigin: false },
    },
  },
});
