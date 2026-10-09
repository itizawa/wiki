// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ビルド後に Cloudflare Pages 用のファイルを出力する。
 * - _redirects：旧slug・slug無しURL → 正規URL（301）
 * - _headers：限定公開ページに noindex / no-referrer
 * - page-routes.json：functions/_middleware.ts が使う（任意のslug違いの301、削除記事の410）
 * @returns {import("astro").AstroIntegration}
 */
export function publicFiles() {
  return {
    name: "wiki-public-files",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        const manifest = await loadManifestForIntegration();
        const redirects = manifest.redirects.map((r) => `${r.from} ${r.to} 301`).join("\n");
        await writeFile(resolve(outDir, "_redirects"), redirects ? `${redirects}\n` : "");
        await writeFile(
          resolve(outDir, "_headers"),
          ["/u/*", "  X-Robots-Tag: noindex, nofollow", "  Referrer-Policy: no-referrer", ""].join("\n"),
        );
        const routes = {
          canonical: Object.fromEntries(manifest.pages.map((p) => [p.id, p.path])),
          gone: manifest.gone,
        };
        await writeFile(resolve(outDir, "page-routes.json"), JSON.stringify(routes));
      },
    },
  };
}

/** @returns {Promise<import("@wiki/shared").PublicManifest>} */
async function loadManifestForIntegration() {
  return JSON.parse(await readFile(resolve(process.env.MANIFEST_PATH ?? ".manifest.json"), "utf8"));
}
