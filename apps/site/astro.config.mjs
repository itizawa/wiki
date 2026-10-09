// @ts-check
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { publicFiles } from "./src/integrations/public-files.mjs";

export default defineConfig({
  site: process.env.SITE_ORIGIN ?? "http://localhost:4321",
  output: "static",
  // /p/{id} はファイル、/u/{key}/ はディレクトリとして出す
  build: { format: "preserve" },
  trailingSlash: "ignore",
  integrations: [react(), publicFiles()],
});
