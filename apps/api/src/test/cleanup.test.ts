import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newImageName } from "@wiki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupImages, IMAGE_CLEANUP_MAX_DELETED, referencedImageNames } from "../images/cleanup";
import { dirImageStore } from "../images/dir";
import { memoryImageStore, r2ImageStore, type R2BucketLike } from "../images/store";
import { cleanupOAuth } from "../oauth/cleanup";
import {
  approveAuthorization,
  authenticateAccessToken,
  exchangeCode,
  hashSecret,
  refreshTokens,
  registerClient,
  revokeGrant,
  type TokenResponse,
} from "../oauth/service";
import { markBuildTriggered, requestBuild } from "../publishing/builds";
import { cleanupBuilds } from "../publishing/cleanup";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
  vi.restoreAllMocks();
});

const internal = (method: string, path: string, body?: unknown) =>
  ctx.call(method, path, body, { authorization: "Bearer cron-token", cookie: "" });

const DAY = 24 * 60 * 60_000;
const count = async (table: string) => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);

// ---------------------------------------------------------------------------
// OAuth のトークンと認可コード
// ---------------------------------------------------------------------------

const REDIRECT = "https://client.example/callback";

/** アプリの登録 → 同意 → コードの引き換え、までを通す */
async function connect() {
  const client = await registerClient(ctx.db, { name: "テストのアプリ", redirectUris: [REDIRECT] });
  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const code = await approveAuthorization(
    ctx.db,
    { clientId: client.id, redirectUri: REDIRECT, codeChallenge, state: null, scopes: ["wiki.read"] },
    ctx.owner.id,
    ["wiki.read"],
  );
  const exchange = () => exchangeCode(ctx.db, { code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier });
  const tokens = await exchange();
  const grantId = (await ctx.client.query<{ grant_id: string }>(`select grant_id from oauth_codes where code_hash = $1`, [await hashSecret(code)])).rows[0]!.grant_id;
  const refresh = (refreshToken: string) => refreshTokens(ctx.db, { refreshToken, clientId: client.id });
  return { client, code, tokens, grantId, exchange, refresh };
}

/** トークンの期限を、いまから days 日前にする */
async function expireToken(token: string, days: number) {
  await ctx.client.query(`update oauth_tokens set expires_at = now() - make_interval(days => $1) where token_hash = $2`, [days, await hashSecret(token)]);
}
async function expireCode(code: string, days: number) {
  await ctx.client.query(`update oauth_codes set expires_at = now() - make_interval(days => $1) where code_hash = $2`, [days, await hashSecret(code)]);
}
const hasToken = async (token: string) =>
  (await ctx.client.query(`select 1 from oauth_tokens where token_hash = $1`, [await hashSecret(token)])).rows.length === 1;
const authenticated = async (token: string) => {
  const res = await authenticateAccessToken(ctx.db, token);
  return res !== null && res !== "rate_limited";
};

describe("cleaning up OAuth tokens and codes", () => {
  it("deletes expired access tokens of a connection in use, and keeps the connection working", async () => {
    ctx = await setup();
    const c = await connect();
    const t0 = c.tokens;
    const t1 = await c.refresh(t0.refresh_token);
    const t2 = await c.refresh(t1.refresh_token);
    // 古い2組は、期限をずっと前に過ぎた。認可コードも同じ
    for (const t of [t0, t1]) {
      await expireToken(t.access_token, 40);
      await expireToken(t.refresh_token, 40);
    }
    await expireCode(c.code, 40);

    // 消えるのは、期限を過ぎたアクセストークンだけ
    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 2, codes: 0 });
    expect(await hasToken(t0.access_token)).toBe(false);
    expect(await hasToken(t1.access_token)).toBe(false);
    // 入れ替え済みのリフレッシュトークンと、使った認可コードは、許可が使えるあいだ残す（再利用の検知に要る）
    expect(await hasToken(t0.refresh_token)).toBe(true);
    expect(await hasToken(t1.refresh_token)).toBe(true);
    expect(await count("oauth_codes")).toBe(1);
    // 続けて呼んでも、何も消さない
    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 0, codes: 0 });

    // いまのトークンは通り、入れ替えもできる
    expect(await authenticated(t2.access_token)).toBe(true);
    const t3 = await c.refresh(t2.refresh_token);
    expect(await authenticated(t3.access_token)).toBe(true);
  });

  it("still revokes the connection when a rotated refresh token is reused after the cleanup", async () => {
    ctx = await setup();
    const c = await connect();
    const t1 = await c.refresh(c.tokens.refresh_token);
    await expireToken(c.tokens.access_token, 40);
    await expireToken(c.tokens.refresh_token, 40);
    await cleanupOAuth(ctx.db);

    await expect(c.refresh(c.tokens.refresh_token)).rejects.toMatchObject({ error: "invalid_grant", message: "refresh token already used" });
    expect(await authenticated(t1.access_token)).toBe(false);
  });

  it("still revokes the connection when a used code is used again after the cleanup", async () => {
    ctx = await setup();
    const c = await connect();
    await expireCode(c.code, 40);
    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 0, codes: 0 });

    await expect(c.exchange()).rejects.toMatchObject({ error: "invalid_grant", message: "code already used" });
    expect(await authenticated(c.tokens.access_token)).toBe(false);
  });

  it("keeps tokens that have not expired, and ones that expired within the last 7 days", async () => {
    ctx = await setup();
    const c = await connect();
    const t1 = await c.refresh(c.tokens.refresh_token);
    await expireToken(c.tokens.access_token, 6);
    await expireToken(c.tokens.refresh_token, 6);
    await revokeGrant(ctx.db, c.grantId);

    // 取り消した許可のトークンでも、期限の前・期限から7日以内なら残す
    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 0, codes: 0 });
    expect(await count("oauth_tokens")).toBe(4);
    expect(await hasToken(t1.refresh_token)).toBe(true);
  });

  it("deletes everything that expired from revoked and expired connections, but not the grant", async () => {
    ctx = await setup();
    const revoked = await connect();
    const expired = await connect();
    const live = await connect();
    const all: TokenResponse[] = [revoked.tokens, await revoked.refresh(revoked.tokens.refresh_token), expired.tokens, live.tokens];
    for (const t of all) {
      await expireToken(t.access_token, 8);
      await expireToken(t.refresh_token, 8);
    }
    for (const c of [revoked, expired, live]) await expireCode(c.code, 8);
    await revokeGrant(ctx.db, revoked.grantId);
    await ctx.client.query(`update oauth_grants set expires_at = now() - interval '1 day' where id = $1`, [expired.grantId]);

    // revoked：4つとコード、expired：2つとコード、live：アクセストークンだけ
    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 7, codes: 2 });
    expect(await hasToken(live.tokens.refresh_token)).toBe(true);
    expect(await count("oauth_grants")).toBe(3);
    expect(await count("oauth_clients")).toBe(3);
  });

  it("deletes codes that were never used once they expire", async () => {
    ctx = await setup();
    const client = await registerClient(ctx.db, { name: "アプリ", redirectUris: [REDIRECT] });
    const request = { clientId: client.id, redirectUri: REDIRECT, codeChallenge: "x", state: null, scopes: ["wiki.read" as const] };
    const old = await approveAuthorization(ctx.db, request, ctx.owner.id, ["wiki.read"]);
    await approveAuthorization(ctx.db, request, ctx.owner.id, ["wiki.read"]);
    await expireCode(old, 8);

    expect(await cleanupOAuth(ctx.db)).toEqual({ tokens: 0, codes: 1 });
    expect(await count("oauth_codes")).toBe(1);
  });

  it("deletes at most the batch size in one run, oldest first", async () => {
    ctx = await setup();
    const c = await connect();
    const t1 = await c.refresh(c.tokens.refresh_token);
    const t2 = await c.refresh(t1.refresh_token);
    await expireToken(c.tokens.access_token, 30);
    await expireToken(t1.access_token, 20);
    await expireToken(t2.access_token, 10);

    expect(await cleanupOAuth(ctx.db, new Date(), 2)).toEqual({ tokens: 2, codes: 0 });
    expect(await hasToken(t2.access_token)).toBe(true);
    expect(await cleanupOAuth(ctx.db, new Date(), 2)).toEqual({ tokens: 1, codes: 0 });
  });
});

// ---------------------------------------------------------------------------
// 公開イベントとビルド
// ---------------------------------------------------------------------------

async function newPage(title: string, bodyMd = "") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}
const publish = (page: { id: string; headVersionId: string }) =>
  ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });

/** いまある公開イベントとビルドを、days 日前のものにする（順番は変えない） */
async function ageBuilds(days: number) {
  await ctx.client.query(`update publish_events set created_at = created_at - make_interval(days => $1)`, [days]);
  await ctx.client.query(`update site_builds set requested_at = requested_at - make_interval(days => $1), triggered_at = triggered_at - make_interval(days => $1)`, [days]);
}
const buildIds = async () => (await ctx.client.query<{ id: string }>(`select id from site_builds order by requested_at`)).rows.map((r) => r.id);

describe("cleaning up publish events and builds", () => {
  it("deletes reflected events and old builds after 30 days, and build requests behave as before", async () => {
    ctx = await setup();
    const now = Date.now();
    const page = await newPage("p", "v1");
    await publish(page);
    const first = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    if (!first.trigger) throw new Error("expected a build");
    await markBuildTriggered(ctx.db, first.buildId, new Date(now + 210_000));
    await publish(page);
    expect(await requestBuild(ctx.db, { now: new Date(now + 600_000) })).toEqual({ trigger: false, reason: "unchanged" });
    const [, second] = await buildIds();
    await ageBuilds(40);
    const events = await count("publish_events");
    expect(events).toBeGreaterThanOrEqual(2);

    // イベントは全部反映済み。ビルドは、いちばん新しい行（起動済みのいちばん新しい行でもある）だけを残す
    expect(await cleanupBuilds(ctx.db)).toEqual({ events, builds: 1 });
    expect(await count("publish_events")).toBe(0);
    expect(await buildIds()).toEqual([second]);
    expect(await cleanupBuilds(ctx.db)).toEqual({ events: 0, builds: 0 });

    // 新しいイベントが無ければ no_changes（消したイベントを「まだ反映していない」と取り違えない）
    expect(await requestBuild(ctx.db, { now: new Date(now + 700_000) })).toEqual({ trigger: false, reason: "no_changes" });
    // 内容が変わらない操作は unchanged（比べる相手の行が残っている）
    await publish(page);
    expect(await requestBuild(ctx.db, { now: new Date(now + 1_000_000) })).toEqual({ trigger: false, reason: "unchanged" });
    // 内容が変われば、今までどおりビルドする
    const saved = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "p", bodyMd: "v2" });
    await publish({ id: page.id, headVersionId: saved.body.headVersionId });
    expect((await requestBuild(ctx.db, { now: new Date(now + 2_000_000) })).trigger).toBe(true);
  });

  it("keeps a build whose deploy hook has not been called, the last deployed build, and events not reflected yet", async () => {
    ctx = await setup();
    const now = Date.now();
    const page = await newPage("p", "v1");
    await publish(page);
    const deployed = await requestBuild(ctx.db, { now: new Date(now + 200_000) });
    if (!deployed.trigger) throw new Error("expected a build");
    await markBuildTriggered(ctx.db, deployed.buildId, new Date(now + 210_000));
    const saved = await ctx.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "p", bodyMd: "v2" });
    const v2 = { id: page.id, headVersionId: saved.body.headVersionId as string };
    await publish(v2);
    // デプロイフックが失敗したまま
    const failed = await requestBuild(ctx.db, { now: new Date(now + 600_000) });
    if (!failed.trigger) throw new Error("expected a build");
    const reflected = await count("publish_events");
    await ageBuilds(40);

    expect(await cleanupBuilds(ctx.db)).toEqual({ events: reflected, builds: 0 });
    expect(await buildIds()).toEqual([deployed.buildId, failed.buildId]);
    // 起動し直しは、今までどおり同じビルドを返す
    expect(await requestBuild(ctx.db, { now: new Date(now + 900_000) })).toEqual({ ...failed, attempts: 2 });

    // まだ反映していないイベントは、古くても消さない
    await publish(v2);
    await ctx.client.query(`update publish_events set created_at = created_at - interval '40 days'`);
    const pending = await count("publish_events");
    expect(pending).toBeGreaterThanOrEqual(1);
    expect(await cleanupBuilds(ctx.db)).toEqual({ events: 0, builds: 0 });
    expect(await count("publish_events")).toBe(pending);
    // 残したイベントで、今までどおりビルドが決まる（失敗したビルドと同じ内容でも、公開サイトには出ていないのでビルドする）
    const next = await requestBuild(ctx.db, { now: new Date(now + 1_200_000) });
    if (!next.trigger) throw new Error("expected a build");
    expect(next.buildId).not.toBe(failed.buildId);
    expect(next.contentHash).toBe(failed.contentHash);
  });

  it("deletes nothing while no build has been requested", async () => {
    ctx = await setup();
    await publish(await newPage("p"));
    await ctx.client.query(`update publish_events set created_at = created_at - interval '40 days'`);
    const events = await count("publish_events");

    expect(await cleanupBuilds(ctx.db)).toEqual({ events: 0, builds: 0 });
    expect(await count("publish_events")).toBe(events);
    // 2分のデバウンスを待たずに起動する（最古のイベントから15分以上たっている）
    expect((await requestBuild(ctx.db, { now: new Date() })).trigger).toBe(true);
  });

  it("keeps events and builds from the last 30 days, and deletes at most the batch size", async () => {
    ctx = await setup();
    const now = Date.now();
    const page = await newPage("p", "v1");
    for (let i = 0; i < 3; i++) {
      await publish(page);
      const build = await requestBuild(ctx.db, { now: new Date(now + (i + 1) * 1_000_000) });
      if (build.trigger) await markBuildTriggered(ctx.db, build.buildId, new Date(now + (i + 1) * 1_000_000));
    }
    const [b1, b2, b3] = (await buildIds()) as [string, string, string];
    const events = await count("publish_events");
    await ageBuilds(29);
    expect(await cleanupBuilds(ctx.db)).toEqual({ events: 0, builds: 0 });

    await ageBuilds(2);
    // 1回に1件ずつ、古い方から消す
    expect(await cleanupBuilds(ctx.db, new Date(), 1)).toEqual({ events: 1, builds: 1 });
    expect(b1).toBeDefined();
    expect(await buildIds()).toEqual([b2, b3]);
    expect(await count("publish_events")).toBe(events - 1);
  });
});

// ---------------------------------------------------------------------------
// 画像
// ---------------------------------------------------------------------------

const store = () => ctx.images as ReturnType<typeof memoryImageStore>;

/** days 日前にアップロードした画像を置き、名前を返す */
function image(days: number, type: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png") {
  const name = newImageName(type);
  store().files.set(name, { body: new Uint8Array([1]), contentType: type, uploaded: new Date(Date.now() - days * DAY) });
  return name;
}
const md = (name: string) => `前\n\n![図](/images/${name})\n\n後`;
const has = (name: string) => store().files.has(name);

describe("cleaning up unreferenced images", () => {
  it("keeps every image that is referenced somewhere", async () => {
    ctx = await setup();
    const green = { presetLight: "simple-light", presetDark: "simple-dark" };
    const names = {
      head: image(60),
      oldVersion: image(60, "image/jpeg"),
      twoInOneBody: image(60, "image/gif"),
      absoluteUrl: image(60),
      htmlTag: image(60, "image/webp"),
      draft: image(60),
      template: image(60),
      home: image(60),
      logo: image(60),
      favicon: image(60, "image/webp"),
      wikiIcon: image(60),
      trashed: image(60),
      archivedWiki: image(60),
      archivedWikiIcon: image(60),
    };

    // いまの版と、前の版
    const page = await newPage("p", md(names.oldVersion));
    const saved = await ctx.call("PUT", `${W}/pages/${page.id}`, {
      baseVersionId: page.headVersionId,
      title: "p",
      bodyMd: `${md(names.head)} ![2](/images/${names.twoInOneBody}) ![abs](https://wiki.site.test/images/${names.absoluteUrl}) <img src="/images/${names.htmlTag}">`,
    });
    expect(saved.status).toBe(200);
    // 下書き
    const draft = await ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: saved.body.headVersionId, title: "p", bodyMd: md(names.draft) });
    expect(draft.status).toBe(200);
    // テンプレート、トップページの自由記述、テーマ、wiki の画像
    expect((await ctx.call("POST", `${W}/templates`, { title: "ひな形", bodyMd: md(names.template) })).status).toBe(201);
    expect((await ctx.call("PUT", `${W}/home`, { introMd: md(names.home) })).status).toBe(200);
    const theme = { ...green, logo: `/images/${names.logo}`, favicon: `/images/${names.favicon}` };
    expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme })).status).toBe(200);
    expect((await ctx.call("PATCH", "/admin/wikis/wiki", { iconUrl: `/images/${names.wikiIcon}` })).status).toBe(200);
    // ゴミ箱のページ（元に戻せるので、版が残っている）
    const trashed = await newPage("ゴミ箱", md(names.trashed));
    expect((await ctx.call("DELETE", `${W}/pages/${trashed.id}`)).status).toBe(200);
    // アーカイブ中の wiki のページと、その wiki の画像
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート", iconUrl: `/images/${names.archivedWikiIcon}` })).status).toBe(201);
    expect((await ctx.call("POST", "/admin/w/notes/pages", { title: "n", bodyMd: md(names.archivedWiki) })).status).toBe(201);
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);

    expect(await referencedImageNames(ctx.db)).toEqual(new Set(Object.values(names)));
    const orphan = image(60);
    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 15, truncated: false, unreferenced: 1, deleted: 1 });
    expect(has(orphan)).toBe(false);
    for (const [where, name] of Object.entries(names)) expect(has(name), where).toBe(true);
  });

  it("keeps images uploaded within the last 30 days, and anything that is not named like an uploaded image", async () => {
    ctx = await setup();
    const fresh = image(29);
    const old = image(31);
    store().files.set("notes.txt", { body: new Uint8Array([1]), contentType: "text/plain", uploaded: new Date(0) });
    store().files.set(`backup/${old}`, { body: new Uint8Array([1]), contentType: "image/png", uploaded: new Date(0) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 4, truncated: false, unreferenced: 1, deleted: 1 });
    expect(has(fresh)).toBe(true);
    expect(has(old)).toBe(false);
    expect(has("notes.txt")).toBe(true);
    expect(has(`backup/${old}`)).toBe(true);
    // 消す前に、件数をログに出す
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({
      imageCleanup: { listed: 4, truncated: false, old: 1, referenced: 0, unreferenced: 1, deleting: 1 },
    });
  });

  it("deletes an image only a permanently deleted page was using, once it is older than 30 days", async () => {
    ctx = await setup();
    const name = image(60);
    const recent = image(10);
    const page = await newPage("消す", `${md(name)}\n${md(recent)}`);
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    // ゴミ箱にあるあいだは消さない
    expect((await cleanupImages(ctx.db, store())).deleted).toBe(0);

    expect((await ctx.call("DELETE", `${W}/pages/${page.id}/trash`)).status).toBe(200);
    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 2, truncated: false, unreferenced: 1, deleted: 1 });
    expect(has(name)).toBe(false);
    // アップロードから30日たっていない方は、参照が無くなってもまだ残す
    expect(has(recent)).toBe(true);
  });

  it("deletes at most 1000 images in one run and leaves the rest for the next run", async () => {
    ctx = await setup();
    const kept = image(60);
    await newPage("p", md(kept));
    for (let i = 0; i < 2500; i++) image(60);

    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 2501, truncated: false, unreferenced: 2500, deleted: IMAGE_CLEANUP_MAX_DELETED });
    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 1501, truncated: false, unreferenced: 1500, deleted: 1000 });
    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 501, truncated: false, unreferenced: 500, deleted: 500 });
    expect(await cleanupImages(ctx.db, store())).toEqual({ listed: 1, truncated: false, unreferenced: 0, deleted: 0 });
    expect(has(kept)).toBe(true);
  });

  it("stops listing at the read limit and says so", async () => {
    ctx = await setup();
    for (let i = 0; i < 30; i++) image(60);
    expect(await cleanupImages(ctx.db, store(), new Date(), { maxListed: 20, maxDeleted: 5 })).toEqual({ listed: 20, truncated: true, unreferenced: 20, deleted: 5 });
    expect(store().files.size).toBe(25);
    // ちょうど読み切ったときは、途中で止めたことにしない
    expect(await cleanupImages(ctx.db, store(), new Date(), { maxListed: 25, maxDeleted: 0 })).toMatchObject({ listed: 25, truncated: false });
  });
});

describe("R2 image store", () => {
  it("lists page by page with the cursor, and deletes in chunks of 1000", async () => {
    const keys = Array.from({ length: 2300 }, (_, i) => `k${String(i).padStart(5, "0")}`);
    const deleted: string[][] = [];
    const bucket: R2BucketLike = {
      put: async () => undefined,
      get: async () => null,
      async list(options = {}) {
        const start = options.cursor ? Number(options.cursor) : 0;
        const end = Math.min(start + (options.limit ?? 1000), keys.length);
        const truncated = end < keys.length;
        return { objects: keys.slice(start, end).map((key) => ({ key, uploaded: new Date(1000) })), truncated, ...(truncated && { cursor: String(end) }) };
      },
      async delete(k) {
        deleted.push(Array.isArray(k) ? k : [k]);
      },
    };
    const images = r2ImageStore(bucket);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      // 1000 より大きい数を頼んでも、R2 の上限に合わせる
      const page = await images.list({ limit: 5000, ...(cursor && { cursor }) });
      expect(page.objects.length).toBeLessThanOrEqual(1000);
      expect(page.objects[0]!.uploaded).toEqual(new Date(1000));
      seen.push(...page.objects.map((o) => o.name));
      cursor = page.cursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(keys);

    await images.delete(keys);
    expect(deleted.map((d) => d.length)).toEqual([1000, 1000, 300]);
  });
});

describe("directory image store (local development)", () => {
  it("lists files with their modification time and deletes them", async () => {
    ctx = await setup();
    const dir = await mkdtemp(join(tmpdir(), "wiki-images-"));
    try {
      const images = dirImageStore(dir, () => "image/png");
      expect(await images.list({ limit: 10 })).toEqual({ objects: [], cursor: null });
      const [a, b, c] = [newImageName("image/png"), newImageName("image/png"), newImageName("image/png")].sort() as [string, string, string];
      for (const name of [a, b, c]) await images.put(name, new Uint8Array([1]), "image/png");
      const old = new Date(Date.now() - 60 * DAY);
      await utimes(join(dir, a), old, old);

      const first = await images.list({ limit: 2 });
      expect(first.objects.map((o) => o.name)).toEqual([a, b]);
      expect(first.objects[0]!.uploaded.getTime()).toBe(old.getTime());
      expect((await images.list({ limit: 2, cursor: first.cursor! })).objects.map((o) => o.name)).toEqual([c]);

      // 古くて参照の無い a だけが消える
      expect(await cleanupImages(ctx.db, images)).toEqual({ listed: 3, truncated: false, unreferenced: 1, deleted: 1 });
      expect((await readdir(dir)).sort()).toEqual([b, c]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("POST /internal/versions/prune", () => {
  it("cleans up tokens, events and builds every time, and images only when asked", async () => {
    ctx = await setup();
    const c = await connect();
    await c.refresh(c.tokens.refresh_token);
    await expireToken(c.tokens.access_token, 40);
    const orphan = image(60);

    const daily = await internal("POST", "/internal/versions/prune", {});
    expect(daily.status).toBe(200);
    expect(daily.body).toEqual({
      deleted: 0,
      structure: { commits: 0, snapshots: 0, nodes: 0 },
      oauth: { tokens: 1, codes: 0 },
      builds: { events: 0, builds: 0 },
      images: null,
    });
    expect(has(orphan)).toBe(true);

    const weekly = await internal("POST", "/internal/versions/prune", { images: true });
    expect(weekly.body).toMatchObject({ oauth: { tokens: 0, codes: 0 }, images: { listed: 1, truncated: false, unreferenced: 1, deleted: 1 } });
    expect(has(orphan)).toBe(false);
  });

  it("still answers with the other counts when the image store fails or is not configured", async () => {
    ctx = await setup();
    image(60);
    vi.spyOn(store(), "list").mockRejectedValue(new Error("R2 is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await internal("POST", "/internal/versions/prune", { images: true });
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ deleted: 0, oauth: { tokens: 0, codes: 0 }, images: null });
    expect(error).toHaveBeenCalled();
    await ctx.close();

    ctx = await setup({ images: null });
    expect((await internal("POST", "/internal/versions/prune", { images: true })).body).toMatchObject({ deleted: 0, images: null });
  });
});
