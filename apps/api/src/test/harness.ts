import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createApp } from "../app";
import type { GoogleReporting } from "../analytics/google";
import type { GoogleOidc } from "../auth/google";
import { SESSION_COOKIE, signSession } from "../auth/session";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { buildManifest } from "../publishing/manifest";
import { bootstrapStructure } from "../structure/repo";
import { DEFAULT_WIKI_KEY } from "../wikis/service";
import { memoryImageStore, type ImageStore } from "../images/store";

export const ADMIN = "admin@example.com";

export const testConfig: AppConfig = {
  adminEmails: [ADMIN],
  sessionSecret: "test-secret-test-secret-test-secret!!",
  adminOrigin: "http://admin.test",
  googleRedirectUri: "http://admin.test/api/auth/google/callback",
  google: null,
  secureCookies: false,
  siteBaseDomain: "site.test",
  internalToken: "internal-token",
  googleServiceAccount: null,
};

/** 最初の wiki（マイグレーションが作る）の経路。wiki の内容を扱う API はこの下にある。 */
export const W = `/admin/w/${DEFAULT_WIKI_KEY}`;

/** 1つの wiki の公開内容（既定は最初の wiki）。 */
export async function wikiManifest(db: Db, key = DEFAULT_WIKI_KEY) {
  const wiki = (await buildManifest(db)).wikis.find((w) => w.key === key);
  if (!wiki) throw new Error(`wiki ${key} is not in the manifest`);
  return wiki;
}

export async function setup(opts: { google?: GoogleOidc; config?: Partial<AppConfig>; images?: ImageStore | null; reporting?: GoogleReporting | null } = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await bootstrapStructure(db);
  const config = { ...testConfig, ...opts.config };
  const images = opts.images === undefined ? memoryImageStore() : opts.images;
  const app = createApp({ db, config, google: opts.google ?? null, images, reporting: opts.reporting ?? null });
  const cookie = `${SESSION_COOKIE}=${await signSession(config.sessionSecret, ADMIN)}`;

  /** body が Uint8Array なら、そのまま（JSON にせず）送る */
  async function call<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const raw = body instanceof Uint8Array;
    const res = await app.request(path, {
      method,
      headers: {
        cookie,
        origin: config.adminOrigin,
        ...(body !== undefined && { "content-type": raw ? "application/octet-stream" : "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
    const isJson = res.headers.get("content-type")?.startsWith("application/json") ?? false;
    const text = isJson ? await res.text() : "";
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers, res };
  }

  return { app, db, client, config, images, call, close: () => client.close() };
}

/** 複数ツリー時代のデータを再現する：primary以外のツリーを現在のheadコミットに直接足す。 */
export async function addLegacyTree(client: PGlite, key = "by-theme") {
  const id = `t_${key}`;
  await client.query(
    `insert into trees (id, wiki_id, key, name, is_primary) select $1, id, $2, $3, false from wikis where key = 'wiki'`,
    [id, key, key],
  );
  const snap = await client.query<{ id: string }>(`insert into tree_snapshots (tree_id) values ($1) returning id`, [id]);
  await client.query(
    `insert into commit_trees (commit_id, tree_id, snapshot_id)
     select head_commit_id, $1, $2 from structure_branches where name = 'main' and wiki_id = (select id from wikis where key = 'wiki')`,
    [id, snap.rows[0]!.id],
  );
  return id;
}
