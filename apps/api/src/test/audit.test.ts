import { auditSentenceText, type AuditLogEntry } from "@wiki/shared";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../auth/session";
import { auditLogs, scheduledActions, users, wikiMembers } from "../db/schema";
import { runDueActions } from "../publishing/scheduler";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

type Call = Awaited<ReturnType<typeof setup>>["call"];

/** 監査ログ（新しい順）。既定はオーナーとして、全体の一覧を読む。 */
async function logs(path = "/admin/audit-logs", call: Call = ctx.call): Promise<AuditLogEntry[]> {
  const res = await call("GET", path);
  expect(res.status).toBe(200);
  return res.body.entries;
}

/** 古い順の [操作, 文]。 */
async function trail(path?: string): Promise<[string, string][]> {
  return (await logs(path)).reverse().map((e) => [e.action, auditSentenceText(e)]);
}

async function newPage(title: string, bodyMd = "", call: Call = ctx.call) {
  const res = await call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body as { id: string; headVersionId: string };
}

const future = (ms = 3600_000) => new Date(Date.now() + ms).toISOString();

describe("audit log: what is recorded", () => {
  it("records logins, denied logins and logouts, with the IP address and User-Agent only for logins", async () => {
    let identity = { sub: "g-owner", email: "admin@example.com", emailVerified: true, name: "オーナー" };
    ctx = await setup({
      google: {
        authorizationUrl: ({ state }) => `https://accounts.example/auth?state=${state}`,
        exchangeCode: async () => identity,
      },
    });
    await ctx.db.update(users).set({ googleSub: "g-owner" }).where(eq(users.id, ctx.owner.id));
    const headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1.0" };
    const callback = async () => {
      const login = await ctx.app.request("/auth/google/login");
      const state = new URL(login.headers.get("location")!).searchParams.get("state");
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      return ctx.app.request(`/auth/google/callback?code=c&state=${state}`, { headers: { cookie, ...headers } });
    };

    const ok = await callback();
    const session = ok.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    identity = { sub: "g-stranger", email: "stranger@example.com", emailVerified: true, name: "知らない人" };
    await callback();
    identity = { sub: "g-unverified", email: "unverified@example.com", emailVerified: false, name: "未確認" };
    await callback();
    await ctx.app.request("/auth/logout", { method: "POST", headers: { cookie: session, origin: ctx.config.adminOrigin, ...headers } });

    const entries = (await logs()).reverse();
    expect(entries.map((e) => [e.action, e.actor.label, e.actor.email, auditSentenceText(e)])).toEqual([
      ["login", "オーナー", "admin@example.com", "ログインしました"],
      ["login_denied", "知らない人", "stranger@example.com", "ログインを拒否しました（招待されていない）"],
      ["login_denied", "未確認", "unverified@example.com", "ログインを拒否しました（メールアドレスが未確認）"],
      ["logout", "オーナー", "admin@example.com", "ログアウトしました"],
    ]);
    expect(entries.map((e) => [e.ip, e.userAgent])).toEqual([
      ["203.0.113.7", "TestBrowser/1.0"],
      ["203.0.113.7", "TestBrowser/1.0"],
      ["203.0.113.7", "TestBrowser/1.0"],
      [null, null],
    ]);
    expect(entries.every((e) => e.wiki === null)).toBe(true);
    expect(entries[0]!.actor.userId).toBe(ctx.owner.id);
    expect(entries[1]!.actor.userId).toBeNull();
  });

  it("records invites, role changes, removals, leaving and owner changes", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("sakura@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("minato@example.com", { wiki: "editor" });
    const leaver = await ctx.addUser("leaver@example.com", { wiki: "editor" });

    const invite = (await admin.call("POST", `${W}/invites`, { role: "editor" })).body;
    const joiner = await ctx.addUser("joiner@example.com");
    expect((await joiner.call("POST", "/invites/accept", { token: invite.token })).status).toBe(200);
    const revoked = (await admin.call("POST", `${W}/invites`, { role: "admin" })).body;
    await admin.call("POST", `${W}/invites/${revoked.invite.id}/revoke`);
    await admin.call("PATCH", `${W}/members/${editor.user.id}`, { role: "admin" });
    await admin.call("DELETE", `${W}/members/${editor.user.id}`);
    await leaver.call("DELETE", `${W}/members/${leaver.user.id}`);
    await ctx.call("PUT", `/admin/users/${admin.user.id}/owner`, { isOwner: true });
    await ctx.call("PUT", `/admin/users/${admin.user.id}/owner`, { isOwner: false });

    expect(await trail()).toEqual([
      ["invite_create", "編集者の招待リンクを発行しました"],
      ["invite_accept", "招待リンクを使って編集者として参加しました"],
      ["invite_create", "管理者の招待リンクを発行しました"],
      ["invite_revoke", "管理者の招待リンクを無効にしました"],
      ["member_role_change", "minato のロールを変更しました（編集者 → 管理者）"],
      ["member_remove", "minato をメンバーから外しました（管理者）"],
      ["member_leave", "この wiki から抜けました（編集者）"],
      ["owner_add", "sakura をオーナーにしました"],
      ["owner_remove", "sakura をオーナーから外しました"],
    ]);
    const entries = (await logs()).reverse();
    expect(entries.map((e) => e.actor.label)).toEqual(["sakura", "joiner", "sakura", "sakura", "sakura", "sakura", "leaver", "オーナー", "オーナー"]);
    // メンバーの操作は wiki のもの、オーナーの変更は全体のもの
    expect(entries.map((e) => e.wiki?.key ?? null)).toEqual(["wiki", "wiki", "wiki", "wiki", "wiki", "wiki", "wiki", null, null]);
  });

  it("records publishing, visibility changes, URL rotation, schedules and the trash", async () => {
    ctx = await setup();
    const parent = await newPage("はじめに", "本文");
    const child = (await ctx.call("POST", `${W}/pages`, { title: "子", parentPageId: parent.id })).body;
    const call = ctx.call;
    await call("POST", `${W}/pages/${parent.id}/publish`, { versionId: parent.headVersionId, visibility: "public" });
    await call("POST", `${W}/pages/${child.id}/publish`, { versionId: child.headVersionId, visibility: "public" });
    await call("POST", `${W}/pages/${parent.id}/publish`, { versionId: parent.headVersionId, visibility: "unlisted", applyToDescendants: true });
    await call("POST", `${W}/pages/${parent.id}/unlisted-key`);
    const edited = (await call("PUT", `${W}/pages/${parent.id}`, { baseVersionId: parent.headVersionId, title: "はじめに", bodyMd: "v2" })).body;
    await call("POST", `${W}/pages/${parent.id}/publish`, { versionId: edited.headVersionId, visibility: "unlisted" });
    await call("POST", `${W}/pages/${parent.id}/unpublish`, { applyToDescendants: true });
    const runAt = future();
    const action = (await call("POST", `${W}/schedule`, { actionType: "unpublish_page", pageId: child.id, runAt })).body;
    const later = future(7200_000);
    await call("PATCH", `${W}/schedule/${action.id}`, { runAt: later });
    await call("POST", `${W}/schedule/${action.id}/cancel`);
    await call("DELETE", `${W}/pages/${child.id}`);
    await call("POST", `${W}/pages/${child.id}/restore`);
    await call("DELETE", `${W}/pages/${parent.id}`);
    await call("DELETE", `${W}/pages/${parent.id}/trash`);

    const at = (iso: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    expect(await trail(`${W}/audit-logs`)).toEqual([
      ["page_publish", "「はじめに」を公開しました（非公開 → 公開）"],
      ["page_publish", "「子」を公開しました（非公開 → 公開）"],
      ["page_visibility_change", "「はじめに」の公開範囲を変更しました（公開 → 限定公開、配下の 1 ページも）"],
      ["unlisted_key_rotate", "「はじめに」の限定公開 URL を再発行しました"],
      ["page_publish", "「はじめに」を公開し直しました（限定公開）"],
      ["page_unpublish", "「はじめに」を非公開にしました（限定公開 → 非公開、配下の 1 ページも）"],
      ["schedule_create", `「子」の非公開化の予約を作成しました（${at(runAt)}）`],
      ["schedule_update", `「子」の非公開化の予約の日時を変更しました（${at(runAt)} → ${at(later)}）`],
      ["schedule_cancel", `「子」の非公開化の予約を取り消しました（${at(later)}）`],
      ["page_delete", "「子」をゴミ箱に入れました"],
      ["page_restore", "「子」をゴミ箱から元に戻しました"],
      ["page_delete", "「はじめに」をゴミ箱に入れました（配下の 1 ページも）"],
      ["page_purge", "「はじめに」をゴミ箱から完全に削除しました（配下の 1 ページも）"],
    ]);
    // 消したページはリンクにしない
    const entries = await logs(`${W}/audit-logs`);
    expect(entries.find((e) => e.action === "page_purge")!.targetAvailable).toBe(false);
    expect(entries.find((e) => e.action === "page_publish")!.detail).toMatchObject({ visibility: "unlisted", versionId: edited.headVersionId });
  });

  it("records scheduled runs as the system, with who scheduled them, and only the final failure", async () => {
    ctx = await setup();
    const a = await newPage("予約の記事");
    const b = await newPage("失敗する記事");
    const other = await newPage("別の記事");
    const runAt = future(60_000);
    const ok = (await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: a.id, versionId: a.headVersionId, targetVisibility: "public", runAt })).body;
    const bad = (await ctx.call("POST", `${W}/schedule`, { actionType: "publish_page", pageId: b.id, versionId: b.headVersionId, targetVisibility: "public", runAt })).body;
    // 実行時に失敗させる（別のページの版に書き換わった想定）。再試行は残さず、最後の失敗だけを残す
    await ctx.db.update(scheduledActions).set({ versionId: other.headVersionId }).where(eq(scheduledActions.id, bad.id));
    const due = new Date(Date.now() + 120_000);
    await runDueActions(ctx.db, due);
    expect((await logs()).filter((e) => e.action === "schedule_fail")).toHaveLength(0);
    await ctx.db.update(scheduledActions).set({ attempts: 2 }).where(eq(scheduledActions.id, bad.id));
    await runDueActions(ctx.db, due);

    const entries = (await logs()).filter((e) => e.action === "schedule_run" || e.action === "schedule_fail");
    expect(entries.map((e) => [e.action, e.actor.type, e.actor.label, auditSentenceText(e)])).toEqual([
      ["schedule_fail", "system", "システム", "「失敗する記事」の公開の予約の実行に失敗しました（予約した人：オーナー）"],
      ["schedule_run", "system", "システム", "「予約の記事」の公開の予約を実行しました（予約した人：オーナー）"],
    ]);
    expect(entries[1]!.detail).toMatchObject({ scheduleId: ok.id, scheduledBy: { type: "user", userId: ctx.owner.id } });
  });

  it("records wiki creation, renaming, archiving and restoring", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" });
    await ctx.call("PATCH", "/admin/wikis/notes", { name: "ノート" });
    await ctx.call("POST", "/admin/wikis/notes/archive");
    await ctx.call("POST", "/admin/wikis/notes/unarchive");

    const entries = (await logs()).reverse();
    expect(entries.map((e) => [e.action, e.wiki?.key ?? null, auditSentenceText(e)])).toEqual([
      ["wiki_create", null, "wiki 「開発ノート」を作成しました（notes）"],
      ["wiki_update", "notes", "wiki の名前を変更しました（開発ノート → ノート）"],
      ["wiki_archive", null, "wiki 「ノート」をアーカイブしました（notes）"],
      ["wiki_unarchive", null, "wiki 「ノート」をアーカイブから戻しました（notes）"],
    ]);
  });

  it("words the site visibility entries", async () => {
    ctx = await setup();
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: false });
    await ctx.call("PATCH", `${W}/settings`, { sitePublic: true });
    const entries = (await logs("/admin/audit-logs?category=publish")).reverse();
    expect(entries.map((e) => [e.action, auditSentenceText(e)])).toEqual([
      ["wiki_site_visibility", "wiki 「wiki」の公開サイトを非公開にしました（wiki）"],
      ["wiki_site_visibility", "wiki 「wiki」の公開サイトを公開にしました（wiki）"],
    ]);
  });

  it("names the author on versions and structure commits", async () => {
    ctx = await setup();
    const editor = await ctx.addUser("minato@example.com", { wiki: "editor" });
    const page = await newPage("記事", "", editor.call);
    await editor.call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.headVersionId, title: "記事", bodyMd: "v2" });
    const versions = (await ctx.call("GET", `${W}/pages/${page.id}/versions`)).body.versions;
    expect(versions.map((v: any) => v.createdBy?.name)).toEqual(["minato", "minato"]);
    expect((await ctx.call("GET", `${W}/pages/${page.id}`)).body.head.createdBy).toEqual({ id: editor.user.id, name: "minato" });
    const commits = (await ctx.call("GET", `${W}/structure/commits`)).body.commits;
    expect(commits[0].createdBy).toEqual({ id: editor.user.id, name: "minato" });
    // 人の操作ではない初期コミットは空のまま
    expect(commits[commits.length - 1].createdBy).toBeNull();
    // 本文の保存とページの作成は、監査ログには入れない
    expect(await logs()).toEqual([]);
  });
});

describe("audit log: guarantees", () => {
  it("leaves nothing when the operation fails, and fails the operation when the log cannot be written", async () => {
    ctx = await setup();
    const parent = await newPage("親");
    const child = (await ctx.call("POST", `${W}/pages`, { title: "子", parentPageId: parent.id })).body;
    // 親が非公開なので、子は公開できない
    const refused = await ctx.call("POST", `${W}/pages/${child.id}/publish`, { versionId: child.headVersionId, visibility: "public" });
    expect(refused.status).toBe(409);
    expect(await logs()).toEqual([]);

    // 監査ログが書けないときは、操作も失敗させる（記録の無い操作を作らない）
    await ctx.client.query(`alter table audit_logs add constraint audit_logs_block check (action <> 'page_publish')`);
    const res = await ctx.call("POST", `${W}/pages/${parent.id}/publish`, { versionId: parent.headVersionId, visibility: "public" });
    expect(res.status).toBe(500);
    expect((await ctx.call("GET", `${W}/pages/${parent.id}`)).body.publishedVersionId).toBeNull();
  });

  it("shows a wiki's log to its admins only, and the global log to owners only", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" });
    const admin = await ctx.addUser("sakura@example.com", { wiki: "admin" });
    const editor = await ctx.addUser("minato@example.com", { wiki: "editor" });
    const notesAdmin = await ctx.addUser("notes@example.com", { notes: "admin" });
    const page = await newPage("記事");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "public" });

    expect((await admin.call("GET", `${W}/audit-logs`)).body.entries.map((e: any) => e.action)).toEqual(["page_publish"]);
    expect((await editor.call("GET", `${W}/audit-logs`)).status).toBe(403);
    expect((await notesAdmin.call("GET", `${W}/audit-logs`)).status).toBe(404);
    expect((await notesAdmin.call("GET", "/admin/w/notes/audit-logs")).body.entries).toEqual([]);
    for (const who of [admin, editor, notesAdmin]) {
      expect((await who.call("GET", "/admin/audit-logs")).status).toBe(403);
      expect((await who.call("GET", "/admin/audit-logs/actors")).status).toBe(403);
    }
    expect((await editor.call("GET", `${W}/audit-logs/actors`)).status).toBe(403);
    // 全体の一覧：wiki の作成は全体のもの
    const all = await logs();
    expect(all.map((e) => e.action)).toEqual(["page_publish", "wiki_create"]);
    expect((await logs("/admin/audit-logs?wiki=global")).map((e) => e.action)).toEqual(["wiki_create"]);
    expect((await logs("/admin/audit-logs?wiki=wiki")).map((e) => e.action)).toEqual(["page_publish"]);
  });

  it("never stores page bodies, invite tokens or unlisted keys", async () => {
    ctx = await setup();
    const page = await newPage("記事", "とても秘密の本文");
    await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.headVersionId, visibility: "unlisted" });
    const { unlistedKey } = (await ctx.call("POST", `${W}/pages/${page.id}/unlisted-key`)).body;
    const { token } = (await ctx.call("POST", `${W}/invites`, { role: "editor" })).body;
    await ctx.call("DELETE", `${W}/pages/${page.id}`);

    const rows = JSON.stringify(await ctx.db.select().from(auditLogs));
    expect(rows).not.toContain("とても秘密の本文");
    expect(rows).not.toContain(token);
    expect(rows).not.toContain(unlistedKey);
  });

  it("filters by period, person and category, and pages through older entries", async () => {
    ctx = await setup();
    const admin = await ctx.addUser("sakura@example.com", { wiki: "admin" });
    const pages = [];
    for (let i = 0; i < 5; i++) pages.push(await newPage(`記事${i}`, "", admin.call));
    for (const p of pages) await admin.call("POST", `${W}/pages/${p.id}/publish`, { versionId: p.headVersionId, visibility: "public" });
    await ctx.call("POST", `${W}/invites`, { role: "editor" });

    const byAdmin = await logs(`${W}/audit-logs?actor=${admin.user.id}`);
    expect(byAdmin).toHaveLength(5);
    expect((await logs(`${W}/audit-logs?category=member`)).map((e) => e.action)).toEqual(["invite_create"]);
    expect(await logs(`${W}/audit-logs?to=2000-01-01`)).toEqual([]);
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
    expect(await logs(`${W}/audit-logs?from=${today}&to=${today}`)).toHaveLength(6);

    const first = (await ctx.call("GET", `${W}/audit-logs?limit=4`)).body;
    expect(first.entries).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const second = (await ctx.call("GET", `${W}/audit-logs?limit=4&cursor=${encodeURIComponent(first.nextCursor)}`)).body;
    expect(second.entries).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map((e: any) => e.id);
    expect(new Set(ids).size).toBe(6);

    const actors = (await ctx.call("GET", `${W}/audit-logs/actors`)).body.actors;
    expect(actors.map((a: any) => a.label)).toEqual(["sakura", "オーナー"]);
    expect((await ctx.call("GET", `${W}/audit-logs?category=nope`)).status).toBe(400);
  });

  it("offers the wiki's members and the owners as people to filter by, without reading the logs", async () => {
    ctx = await setup();
    await ctx.call("POST", "/admin/wikis", { key: "notes", name: "Notes" });
    // まだ何も操作していないメンバーも、候補に出る。ほかの wiki のメンバーは出ない
    const editor = await ctx.addUser("kaede@example.com", { wiki: "editor" });
    await ctx.addUser("momiji@example.com", { notes: "admin" });
    const actorsOf = async (path: string) => (await ctx.call("GET", path)).body.actors as { userId: string; label: string; email: string }[];
    const labels = async (path: string) => (await actorsOf(path)).map((a) => a.label);
    expect(await labels(`${W}/audit-logs/actors`)).toEqual(["kaede", "オーナー"]);
    expect(await labels("/admin/w/notes/audit-logs/actors")).toEqual(["momiji", "オーナー"]);
    expect(await labels("/admin/audit-logs/actors")).toEqual(["kaede", "momiji", "オーナー"]);
    expect((await actorsOf(`${W}/audit-logs/actors`))[0]).toEqual({ userId: editor.user.id, label: "kaede", email: "kaede@example.com" });

    // 名前は、ログに残った当時のものではなく、いまのもの。名前が無ければメールアドレス
    await ctx.db.update(users).set({ name: null }).where(eq(users.id, editor.user.id));
    expect(await labels(`${W}/audit-logs/actors`)).toEqual(["kaede@example.com", "オーナー"]);

    // wiki から外した人は、その wiki の候補から外れる（全体の一覧の候補には残る）
    await ctx.db.delete(wikiMembers).where(eq(wikiMembers.userId, editor.user.id));
    expect(await labels(`${W}/audit-logs/actors`)).toEqual(["オーナー"]);
    expect(await labels("/admin/audit-logs/actors")).toEqual(["kaede@example.com", "momiji", "オーナー"]);
  });
});
