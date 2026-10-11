import { DEFAULT_THEME, THEME_IMAGE_MAX_BYTES, auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
const green = { accentLight: "#00716b", accentDark: "#4fd1c5", logo: null, favicon: null };

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
    const saved = await ctx.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: { ...green, accentLight: "#00716B" } });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ name: "わたしの wiki", theme: green });
    expect(await events()).toHaveLength(1);

    const manifest = await wikiManifest(ctx.db);
    expect(manifest.name).toBe("わたしの wiki");
    expect(manifest.theme).toEqual(green);

    // 変わっていなければ、ビルドし直さない
    await ctx.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: green });
    expect(await events()).toHaveLength(1);
  });

  it("refuses colors below the contrast bar, each against its own background", async () => {
    ctx = await setup();
    const light = await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...green, accentLight: "#7aa5ff" } });
    expect(light.status).toBe(400);
    const dark = await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...green, accentDark: "#2257c5" } });
    expect(dark.status).toBe(400);
    const broken = await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...green, accentLight: "#00716b;}a{color:red" } });
    expect(broken.status).toBe(400);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
    expect(await events()).toHaveLength(0);
  });

  it("lets only admins of the wiki see and change it", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await editor.call("GET", `${W}/appearance`)).status).toBe(403);
    expect((await editor.call("PUT", `${W}/appearance`, { name: "編集者", theme: green })).status).toBe(403);
    expect((await editor.call("POST", `${W}/appearance/images`, PNG)).status).toBe(403);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);

    expect((await admin.call("PUT", `${W}/appearance`, { name: "管理者", theme: green })).status).toBe(200);
  });

  it("records a name change in the wiki's audit log, with the names before and after", async () => {
    ctx = await setup();
    const before = (await ctx.call("GET", `${W}/appearance`)).body.name as string;
    // オーナーでない wiki の管理者が変えても残る
    const admin = await ctx.addUser("wiki-admin@example.com", { wiki: "admin" });
    expect((await admin.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: green })).status).toBe(200);

    const renames = await wikiUpdates();
    expect(renames).toHaveLength(1);
    expect(renames[0]!.detail).toEqual({ name: { from: before, to: "わたしの wiki" } });
    expect(renames[0]!.actor).toMatchObject({ type: "user", userId: admin.user.id });
    expect(renames[0]!.target).toMatchObject({ type: "wiki", label: "わたしの wiki" });
    expect(auditSentenceText(renames[0]!)).toBe(`wiki の名前を変更しました（${before} → わたしの wiki）`);

    // 同じ内容の保存では増えない
    await admin.call("PUT", `${W}/appearance`, { name: "わたしの wiki", theme: green });
    expect(await wikiUpdates()).toHaveLength(1);
  });

  it("leaves a theme-only change out of the audit log", async () => {
    ctx = await setup();
    const name = (await ctx.call("GET", `${W}/appearance`)).body.name as string;
    expect((await ctx.call("PUT", `${W}/appearance`, { name, theme: green })).status).toBe(200);
    expect(await events()).toHaveLength(1);
    expect(await wikiUpdates()).toHaveLength(0);
  });

  it("keeps one wiki's theme out of another wiki", async () => {
    ctx = await setup();
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("PUT", "/admin/w/notes/appearance", { name: "開発ノート", theme: green })).status).toBe(200);

    expect((await wikiManifest(ctx.db, "notes")).theme).toEqual(green);
    expect((await wikiManifest(ctx.db)).theme).toEqual(DEFAULT_THEME);
    expect((await ctx.call("GET", `${W}/appearance`)).body.theme).toEqual(DEFAULT_THEME);

    // ほかの wiki だけの管理者は、この wiki の外観を開けない
    const notesAdmin = await ctx.addUser("notes-admin@example.com", { notes: "admin" });
    expect((await notesAdmin.call("PUT", `${W}/appearance`, { name: "x", theme: green })).status).toBe(404);
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

    const saved = await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...green, logo: res.body.url, favicon: res.body.url } });
    expect(saved.status).toBe(200);
    expect((await wikiManifest(ctx.db)).theme).toMatchObject({ logo: res.body.url, favicon: res.body.url });

    // SVG や外部の URL は指定できない
    for (const logo of ["/images/abcdefghijklmnopqrstuvwx.svg", "https://example.com/logo.png"]) {
      expect((await ctx.call("PUT", `${W}/appearance`, { name: "wiki", theme: { ...green, logo } })).status).toBe(400);
    }
  });
});
