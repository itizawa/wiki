import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createApp } from "../app";
import type { GoogleReporting } from "../analytics/google";
import type { GoogleOidc } from "../auth/google";
import type { XClient } from "../sns/x-client";
import { issueSession, SESSION_COOKIE } from "../auth/session";
import type { AppConfig } from "../config";
import type { CronMarkStore } from "../cron/marks";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { buildManifest } from "../publishing/manifest";
import { bootstrapStructure } from "../structure/repo";
import { users, wikiMembers, wikis } from "../db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_WIKI_KEY } from "../wikis/service";
import { memoryImageStore, type ImageStore } from "../images/store";
import type { RateLimiter, RateLimiters } from "../rate-limit";

/** setup が作るオーナー（すべての wiki に管理者として入れる）。call はこの人として呼ぶ */
export const ADMIN = "admin@example.com";

export const testConfig: AppConfig = {
  sessionSecret: "test-secret-test-secret-test-secret!!",
  adminOrigin: "http://admin.test",
  googleRedirectUri: "http://admin.test/api/auth/google/callback",
  google: null,
  secureCookies: false,
  siteBaseDomain: "site.test",
  exportToken: "export-token",
  cronToken: "cron-token",
  googleServiceAccount: null,
  x: null,
};

/** 最初の wiki（マイグレーションが作る）の経路。wiki の内容を扱う API はこの下にある。 */
export const W = `/admin/w/${DEFAULT_WIKI_KEY}`;

/** 1つの wiki の公開内容（既定は最初の wiki）。 */
export async function wikiManifest(db: Db, key = DEFAULT_WIKI_KEY) {
  const wiki = (await buildManifest(db)).wikis.find((w) => w.key === key);
  if (!wiki) throw new Error(`wiki ${key} is not in the manifest`);
  return wiki;
}

/**
 * PGlite に読み込む拡張。マイグレーション（0027）が `CREATE EXTENSION pg_trgm` を流すので、
 * マイグレーションを流す側にも、その写しから始める側にも要る（無いと、索引を使う所で落ちる）。
 */
export const pgliteExtensions = { pg_trgm };

let migrated: Promise<Blob | File> | undefined;

/**
 * マイグレーションを流し終えた DB の写し。テストのたびに全部のマイグレーションを流すと遅いので、
 * テストファイルごとに1回だけ流し、各テストはその写しから始める。
 */
function migratedDataDir() {
  return (migrated ??= (async () => {
    const client = new PGlite({ extensions: pgliteExtensions });
    await migrate(drizzle(client) as never, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    const dataDir = await client.dumpDataDir("none");
    await client.close();
    return dataDir;
  })());
}

export async function setup(
  opts: {
    google?: GoogleOidc;
    x?: XClient;
    config?: Partial<AppConfig>;
    images?: ImageStore | null;
    reporting?: GoogleReporting | null;
    rateLimits?: RateLimiters;
    cronMarks?: CronMarkStore | null;
  } = {},
) {
  const client = new PGlite({ loadDataDir: await migratedDataDir(), extensions: pgliteExtensions });
  const db = drizzle(client, { schema }) as unknown as Db;
  await bootstrapStructure(db);
  const config = { ...testConfig, ...opts.config };
  const images = opts.images === undefined ? memoryImageStore() : opts.images;
  const app = createApp({
    db,
    config,
    google: opts.google ?? null,
    x: opts.x ?? null,
    images,
    reporting: opts.reporting ?? null,
    rateLimits: opts.rateLimits ?? null,
    cronMarks: opts.cronMarks ?? null,
  });
  const [owner] = await db.insert(users).values({ googleSub: "test:owner", email: ADMIN, name: "オーナー", isOwner: true }).returning();

  /**
   * userId の人として API を呼ぶ関数を返す（null ならログインしていない）。
   * body が Uint8Array なら、そのまま（JSON にせず）送る
   */
  async function callAs(userId: string | null) {
    const cookie = userId ? `${SESSION_COOKIE}=${await issueSession(db, config.sessionSecret, userId)}` : "";
    return async function <T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const raw = body instanceof Uint8Array;
      const res = await app.request(path, {
        method,
        headers: {
          ...(cookie && { cookie }),
          origin: config.adminOrigin,
          ...(body !== undefined && { "content-type": raw ? "application/octet-stream" : "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
      });
      const isJson = res.headers.get("content-type")?.startsWith("application/json") ?? false;
      const text = isJson ? await res.text() : "";
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers, res };
    };
  }
  const call = await callAs(owner!.id);

  /**
   * ユーザーを作り、wiki のメンバーにして、その人として呼ぶ関数を返す。
   * roles は wiki の key → ロール。
   */
  async function addUser(email: string, roles: Record<string, "admin" | "editor"> = {}, opts: { isOwner?: boolean } = {}) {
    const [user] = await db.insert(users).values({ googleSub: `test:${email}`, email, name: email.split("@")[0], isOwner: opts.isOwner ?? false }).returning();
    for (const [key, role] of Object.entries(roles)) {
      const [wiki] = await db.select().from(wikis).where(eq(wikis.key, key));
      await db.insert(wikiMembers).values({ wikiId: wiki!.id, userId: user!.id, role });
    }
    return { user: user!, call: await callAs(user!.id) };
  }

  return { app, db, client, config, images, call, callAs, addUser, owner: owner!, close: () => client.close() };
}

/** Workers の Rate Limiting のバインディングの代わり。鍵ごとに limit 回まで通す（窓は進まない）。calls は数えた鍵 */
export function fakeRateLimiter(limit: number): RateLimiter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      return { success: calls.filter((k) => k === key).length <= limit };
    },
  };
}

/** 複数ツリー時代のデータを再現する：primary以外のツリーを現在のheadコミットに直接足す。 */
export async function addLegacyTree(client: PGlite, key = "by-theme") {
  const id = `t_${key}`;
  await client.query(
    `insert into trees (id, wiki_id, key, name, is_primary) select $1, id, $2, $3, false from wikis where key = 'wiki'`,
    [id, key, key],
  );
  return id;
}

/**
 * `content-length` の無い（chunked の）アップロードの本文。`first` のあとに、`chunkBytes` の塊を合計 `chunks` 個まで流す。
 * `pulled()` は、読み手が実際に取り出した塊の数（途中で打ち切られたかを確かめる）。
 */
export function chunkedBody(first: Uint8Array, chunkBytes: number, chunks: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      const chunk = new Uint8Array(chunkBytes);
      if (pulled === 0) chunk.set(first);
      pulled++;
      controller.enqueue(chunk);
    },
  });
  return { stream, pulled: () => pulled };
}
