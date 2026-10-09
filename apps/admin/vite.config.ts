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
    },
  },
});
