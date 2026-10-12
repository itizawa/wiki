import { DEFAULT_THEME, THEME_BACKGROUND_MAX_BYTES, THEME_IMAGE_MAX_BYTES, auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, SESSION_COOKIE } from "../auth/session";
import { chunkedBody, setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
const base = { preset: "simple", logo: null, favicon: null, backgroundLight: null, backgroundDark: null };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function events(kind = "wiki_theme") {
  const res = await ctx.client.query<{ wiki_id: string }>(`select wiki_id from publish_events where kind = $1`, [kind]);
  return res.rows;
}

/** その wiki の監査ログのうち、wiki の名前・画像の変更。 */
async function wikiUpdates(): Promise<AuditLogEntry[]> {
  const res = await ctx.call("GET", `${W}/audit-logs`);
  expect(res.status).toBe(200);
  return (res.body.entries as AuditLogEntry[]).filter((e) => e.action === "wiki_update");
}

describe("appearance", () => {
  it("starts with the wiki's name and the default theme", async () => {
    ctx = await setup();
    const res = await ctx.call("GET", `${W}/appearance`);
    expect(res.status).toBe(200);
    expect(res.body.theme).toEqual(DEFAULT_THEME);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
  });

  it("saves the name and theme, records a publish event and puts them in the public manifest", async () => {
    ctx = await setup();
    const logo = (await ctx.call("POST", `${W}/appearance/images`, PNG)).body.url as string;
    const saved = await ctx.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: { ...base, logo } });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ name: "わたしの wiki", theme: { ...base, logo } });
    expect(await events()).toHaveLength(1);

    const manifest = await wikiManifest(ctx.db);
    expect(manifest.name).toBe("わたしの wiki");
    expect(manifest.theme).toEqual({ ...base, logo });
    expect(manifest.theme.preset).toBe("simple");

    // 変わっていなければ、ビルドし直さない
    await ctx.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: { ...base, logo } });
    expect(await events()).toHaveLength(1);
  });

  it("accepts only the keys of defined themes", async () => {
    ctx = await setup();
    for (const theme of [
      { ...base, preset: "unknown" },
      { ...base, preset: "simple-light" },
      { ...base, preset: "simple;}a{color:red" },
      // ライト用・ダーク用を別々に選ぶ古い形は、保存では受け付けない
      { logo: null, favicon: null, presetLight: "simple-light", presetDark: "simple-dark" },
      { logo: null, favicon: null },
      // 古い形（アクセント色だけ）は、保存では受け付けない
      { accentLight: "#00716b", accentDark: "#4fd1c5", logo: null, favicon: null },
    ]) {
      expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme })).status, JSON.stringify(theme)).toBe(400);
    }
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
    expect(await events()).toHaveLength(0);
  });

  it("reads a theme saved in the old form (accent colors only) as the default themes", async () => {
    ctx = await setup();
    await ctx.client.query(`update wikis set theme = $1::jsonb where key = 'wiki'`, [JSON.stringify({ accentLight: "#00716b", accentDark: "#4fd1c5", logo: null, favicon: null })]);
    expect((await ctx.call("GET", `${W}/appearance`)).body.theme).toEqual(DEFAULT_THEME);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
  });

  it("lets only admins of the wiki see and change it", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await editor.call("GET", `${W}/appearance`)).status).toBe(403);
    expect((await editor.call("PUT", `${W}/appearance`, { name: "編集者", theme: base })).status).toBe(403);
    expect((await editor.call("POST", `${W}/appearance/images`, PNG)).status).toBe(403);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);

    expect((await admin.call("PUT", `${W}/appearance`, { name: "管理者", theme: base })).status).toBe(200);
  });

  it("records a name change in the wiki's audit log, with the names before and after", async () => {
    ctx = await setup();
    const before = (await ctx.call("GET", `${W}/appearance`)).body.name as string;
    // オーナーでない wiki の管理者が変えても残る
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await admin.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: base })).status).toBe(200);

    const renames = await wikiUpdates();
    expect(renames).toHaveLength(1);
    expect(renames[0]!.detail).toEqual({ name: { from: before, to: "わたしの wiki" } });
    expect(renames[0]!.actor).toMatchObject({ type: "user", userId: admin.user.id });
    expect(renames[0]!.target).toMatchObject({ type: "wiki", label: "わたしの wiki" });
    expect(auditSentenceText(renames[0]!)).toBe(`wiki の名前を変更しました（${before} → わたしの wiki）`);

    // 同じ内容の保存では増えない
    await admin.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: base });
    expect(await wikiUpdates()).toHaveLength(1);
  });

  it("leaves a theme-only change out of the audit log", async () => {
    ctx = await setup();
    const name = (await ctx.call("GET", `${W}/appearance`)).body.name as string;
    const logo = (await ctx.call("POST", `${W}/appearance/images`, PNG)).body.url as string;
    expect((await ctx.call("PUT", `${W}/appearance`, { name, theme: { ...base, logo } })).status).toBe(200);
    expect(await events()).toHaveLength(1);
    expect(await wikiUpdates()).toHaveLength(0);
  });

  it("keeps one wiki's theme out of another wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    const logo = (await ctx.call("POST", "/admin/w/notes/appearance/images", PNG)).body.url as string;
    expect((await ctx.call("PUT", "/admin/w/notes/appearance", { name: "開発ノート", theme: { ...base, logo } })).status).toBe(200);

    expect((await wikiManifest(ctx.db, "notes")).theme).toEqual({ ...base, logo });
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
    expect((await ctx.call("GET", `${W}/appearance`)).body.theme).toEqual(DEFAULT_THEME);

    // ほかの wiki だけの管理者は、この wiki の外観を開けない
    const notesAdmin = await ctx.addUser("notes-admin@example.com", { notes: "admin" });
    expect((await notesAdmin.call("PUT", `${W}/appearance`, { name: "x", theme: base })).status).toBe(404);
  });

  it("accepts PNG and WebP up to 512KB for the logo and favicon", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/appearance/images`, PNG);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/images\/[0-9a-z]{24}\.png$/);

    expect((await ctx.call("POST", `${W}/appearance/images`, GIF)).status).toBe(415);
    const big = new Uint8Array(THEME_IMAGE_MAX_BYTES + 1);
    big.set(PNG);
    expect((await ctx.call("POST", `${W}/appearance/images`, big)).status).toBe(413);

    const saved = await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...base, logo: res.body.url, favicon: res.body.url } });
    expect(saved.status).toBe(200);
    expect((await wikiManifest(ctx.db)).theme).toMatchObject({ logo: res.body.url, favicon: res.body.url });

    // SVG や外部の URL は指定できない
    for (const logo of ["/images/abcdefghijklmnopqrstuvwx.svg", "https://example.com/logo.png"]) {
      expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...base, logo } })).status).toBe(400);
    }
  });

  it("stops reading a chunked logo upload once it passes 512KB", async () => {
    ctx = await setup();
    const cookie = `${SESSION_COOKIE}=${await issueSession(ctx.db, ctx.config.sessionSecret, ctx.owner.id)}`;
    // 64KB × 100（content-length なし）
    const big = chunkedBody(PNG, 64 * 1024, 100);
    const res = await ctx.app.request(`${W}/appearance/images`, {
      method: "POST",
      headers: { cookie, origin: ctx.config.adminOrigin },
      body: big.stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.details).toMatchObject({ maxBytes: THEME_IMAGE_MAX_BYTES });
    expect(big.pulled()).toBeLessThan(20);
  });
  it("accepts PNG, JPEG and WebP up to 2MB for a background image, and saves its path for light and dark", async () => {
    ctx = await setup();
    const res = await ctx.call("POST", `${W}/appearance/background-images`, JPEG);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/images\/[0-9a-z]{24}\.jpg$/);
    const png = await ctx.call("POST", `${W}/appearance/background-images`, PNG);
    expect(png.status).toBe(201);

    expect((await ctx.call("POST", `${W}/appearance/background-images`, GIF)).status).toBe(415);
    const big = new Uint8Array(THEME_BACKGROUND_MAX_BYTES + 1);
    big.set(JPEG);
    const tooBig = await ctx.call("POST", `${W}/appearance/background-images`, big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.details).toMatchObject({ maxBytes: THEME_BACKGROUND_MAX_BYTES, limit: "PNG・JPEG・WebP、2MB まで" });
    // ロゴ・ファビコンの上限（512KB）は変わらない
    const mid = new Uint8Array(THEME_IMAGE_MAX_BYTES + 1);
    mid.set(JPEG);
    expect((await ctx.call("POST", `${W}/appearance/background-images`, mid)).status).toBe(201);
    expect((await ctx.call("POST", `${W}/appearance/images`, mid)).status).toBe(413);

    const theme = { ...base, preset: "simple", backgroundLight: res.body.url, backgroundDark: png.body.url };
    expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme })).status).toBe(200);
    expect((await wikiManifest(ctx.db)).theme).toEqual(theme);

    // 取り消すと、テーマの画像に戻る（null）
    expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...theme, backgroundLight: null } })).status).toBe(200);
    expect((await wikiManifest(ctx.db)).theme).toMatchObject({ backgroundLight: null, backgroundDark: png.body.url });

    // GIF・SVG・外部の URL・上げていない形のパスは、背景画像に指定できない
    for (const backgroundDark of ["/images/abcdefghijklmnopqrstuvwx.gif", "/images/abcdefghijklmnopqrstuvwx.svg", "https://example.com/bg.png", "/images/x.png"]) {
      expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...theme, backgroundDark } })).status, backgroundDark).toBe(400);
    }
  });

  it("lets only the wiki's admin upload a background image", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("POST", `${W}/appearance/background-images`, JPEG)).status).toBe(403);
  });
});
