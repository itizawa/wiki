// E2E 用に、管理画面（ビルド済みの静的アセット）と API を、本番と同じ1つの Worker（`wrangler dev`）で立てる。
// playwright.config.ts の webServer から呼ばれる。
//
// 環境変数（すべて任意）
//   E2E_ADMIN_DIST     配信する管理画面のビルド成果物のディレクトリ（既定は apps/admin/dist）。
//                      ここでビルドしたものでも、CI が main のビルドを取ってきたものでも、同じ手順で動く
//   E2E_DATABASE_URL   つなぐ PostgreSQL（既定は postgres://postgres:postgres@localhost:5432/wiki_e2e）。
//                      起動のたびにマイグレーションする。手元の開発用の DB とは分ける
//   E2E_PORT           待ち受けるポート（既定は 8789。`pnpm dev` の API :8787 と重ねない）
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "../../api");
const adminDist = resolve(process.env.E2E_ADMIN_DIST ?? resolve(here, "../../admin/dist"));
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wiki_e2e";
const port = process.env.E2E_PORT ?? "8789";
const origin = `http://localhost:${port}`;

if (!existsSync(resolve(adminDist, "index.html"))) {
  console.error(`管理画面のビルドが見つかりません（${adminDist}/index.html）。先に pnpm --filter @wiki/admin build を実行するか、E2E_ADMIN_DIST を指定してください`);
  process.exit(1);
}
console.log(`管理画面: ${adminDist}`);

const migrate = spawnSync("pnpm", ["db:migrate"], { cwd: apiDir, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl } });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// wrangler.toml の [vars] は本番の値（NODE_ENV=production で開発用ログインが無効）なので、E2E の値で上書きする
const vars = {
  NODE_ENV: "development",
  ADMIN_ORIGIN: origin,
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  DEV_LOGIN_EMAIL: "e2e@example.com",
};
// .dev.vars と同じ形のファイルで渡す（[vars] より優先される）
const stateDir = resolve(here, "../.wrangler");
mkdirSync(stateDir, { recursive: true });
const envFile = resolve(stateDir, "e2e.env");
writeFileSync(envFile, Object.entries(vars).map(([k, v]) => `${k}=${v}\n`).join(""));
// Workers AI（`[ai]`）は手元で動かせず、wrangler dev が Cloudflare の API トークンを求めて起動できない。
// E2E では音声入力を使わないので、`[ai]` を除いた設定を同じ場所（相対パスが同じになるように）に作って使う（`AI` が無ければ、音声入力は 503）
const e2eConfig = resolve(apiDir, "wrangler.e2e.toml");
const baseConfig = readFileSync(resolve(apiDir, "wrangler.toml"), "utf8");
const withoutAi = baseConfig.replace(/^\[ai\]\nbinding = "AI"\n/m, "");
if (withoutAi === baseConfig) {
  console.error("wrangler.toml から [ai] を取り除けませんでした（書き方を変えたなら、scripts/serve.mjs も直してください）");
  process.exit(1);
}
writeFileSync(e2eConfig, withoutAi);
const child = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    e2eConfig,
    "--port",
    port,
    "--ip",
    "127.0.0.1",
    // [assets] の directory（../admin/dist）の代わりに、指定のディレクトリを配る。not_found_handling・run_worker_first は wrangler.toml のまま
    "--assets",
    adminDist,
    // KV・R2 などの手元の保存先。apps/api/.wrangler（手元で wrangler dev を動かしたときのもの）と混ぜない
    "--persist-to",
    resolve(stateDir, "state"),
    "--show-interactive-dev-session=false",
    // 手元のリクエストの Host・Origin を、routes の独自ドメイン（wiki-admin.hatchery-works.com）に書き換えさせない。
    // 書き換わると、状態を変えるリクエストの Origin が ADMIN_ORIGIN と合わず 403 になる
    "--local-upstream",
    `localhost:${port}`,
    "--env-file",
    envFile,
  ],
  {
    cwd: apiDir,
    stdio: "inherit",
    // Hyperdrive のバインディング（HYPERDRIVE）は、手元ではこの接続先へ直接つなぐ
    env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl },
  },
);
const cleanup = () => rmSync(e2eConfig, { force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
