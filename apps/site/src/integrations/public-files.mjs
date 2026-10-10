// @ts-check
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Vite と Astro が自分で使う経路。開発サーバーでは wiki の経路へ読み替えない */
const DEV_INTERNAL = /^\/(@|_|src\/|node_modules\/|favicon\.svg)/;

/**
 * ビルド後に Cloudflare（静的アセット）用のファイルを出力する。
 * - _headers：限定公開ページに noindex / no-referrer
 * - {key}/page-routes.json：worker/index.ts が使う（slug つきの旧URLの301、削除記事の410）。wiki ごとに持つ
 *
 * 開発サーバー（astro dev）では Worker が無いので、`/p/...` などの経路を、表示する wiki
 * （環境変数 WIKI。既定は最初の wiki）の `/{key}/p/...` へ読み替える。
 * @returns {import("astro").AstroIntegration}
 */
export function publicFiles() {
  return {
    name: "wiki-public-files",
    hooks: {
      "astro:server:setup": async ({ server }) => {
        const manifest = await loadManifestForIntegration();
        const keys = manifest.wikis.map((w) => w.key);
        const key = process.env.WIKI ?? (keys.includes("wiki") ? "wiki" : keys[0]);
        if (!key) return;
        server.middlewares.use((req, _res, next) => {
          if (req.url && !DEV_INTERNAL.test(req.url)) req.url = `/${key}${req.url}`;
          next();
        });
      },
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        const manifest = await loadManifestForIntegration();
        await writeFile(
          resolve(outDir, "_headers"),
          ["/:wiki/u/*", "  X-Robots-Tag: noindex, nofollow", "  Referrer-Policy: no-referrer", ""].join("\n"),
        );
        for (const wiki of manifest.wikis) {
          const routes = {
            canonical: Object.fromEntries(wiki.pages.map((p) => [p.id, p.path])),
            gone: wiki.gone,
          };
          await mkdir(resolve(outDir, wiki.key), { recursive: true });
          await writeFile(resolve(outDir, wiki.key, "page-routes.json"), JSON.stringify(routes));
        }
      },
    },
  };
}

/** @returns {Promise<import("@wiki/shared").PublicManifest>} */
async function loadManifestForIntegration() {
  return JSON.parse(await readFile(resolve(process.env.MANIFEST_PATH ?? ".manifest.json"), "utf8"));
}
