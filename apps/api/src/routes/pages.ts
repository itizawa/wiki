import {
  createPageInput,
  newPageId,
  savePageDraftInput,
  savePageInput,
  setWorkflowInput,
  type PageDetail,
  type PageDraft,
  type PageSummary,
  type PageVersion,
  type SavePageInput,
  type SetWorkflowInput,
} from "@wiki/shared";
import { and, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { oauthClients, oauthGrants, pageDrafts, pageLinks, pages, pageVersions, scheduledActions, users } from "../db/schema";
import { recordPublishEvent } from "../publishing/service";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { commitOps, loadCommit, getBranch, getPrimaryTree, MAIN_BRANCH, opsToRemovePage } from "../structure/repo";
import { parseJson } from "../validation";
import { findTemplate, renderTemplate } from "./templates";
import { actorUserId, auditActor, writeAudit, type AuditActor } from "../audit/service";

type PageRow = typeof pages.$inferSelect;
type VersionRow = typeof pageVersions.$inferSelect;
type DraftRow = typeof pageDrafts.$inferSelect;

const toSummary = (p: PageRow): PageSummary => ({
  id: p.id,
  title: p.title,
  headVersionId: p.headVersionId,
  publishedVersionId: p.publishedVersionId,
  visibility: p.visibility,
  origin: p.origin,
  unlistedKey: p.unlistedKey,
  firstPublishedAt: p.firstPublishedAt?.toISOString() ?? null,
  workflowState: p.workflowState,
  approvedVersionId: p.approvedVersionId,
  reviewRequestedAt: p.reviewRequestedAt?.toISOString() ?? null,
  updatedAt: p.updatedAt.toISOString(),
});

const toVersion = (v: VersionRow, author: { name: string | null; email: string } | null): PageVersion => ({
  id: v.id,
  pageId: v.pageId,
  baseVersionId: v.baseVersionId,
  title: v.title,
  bodyMd: v.bodyMd,
  authorType: v.authorType,
  createdBy: v.createdBy && author ? { id: v.createdBy, name: author.name ?? author.email } : null,
  createdAt: v.createdAt.toISOString(),
});

/** 版と、それを作った人（いまの名前）。 */
async function findVersion(db: Db, where: ReturnType<typeof eq>): Promise<PageVersion | null> {
  const [row] = await db
    .select({ version: pageVersions, name: users.name, email: users.email })
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.createdBy))
    .where(where);
  return row ? toVersion(row.version, row.email === null ? null : { name: row.name, email: row.email }) : null;
}

const toDraft = (d: DraftRow): PageDraft => ({
  baseVersionId: d.baseVersionId,
  title: d.title,
  bodyMd: d.bodyMd,
  updatedAt: d.updatedAt.toISOString(),
});

const ownDraft = (pageId: string, userId: string) => and(eq(pageDrafts.pageId, pageId), eq(pageDrafts.userId, userId));

/** 指定の wiki のページだけを返す。別の wiki のページ ID を指定しても、無いものとして扱う。 */
export async function findLivePage(db: Db, wikiId: string, id: string, forUpdate = false): Promise<PageRow> {
  const q = db
    .select()
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), eq(pages.id, id), isNull(pages.deletedAt)));
  const [page] = forUpdate ? await q.for("update") : await q;
  if (!page) throw notFound(`page ${id}`);
  return page;
}

export async function getDetail(db: Db, wikiId: string, id: string): Promise<PageDetail> {
  const page = await findLivePage(db, wikiId, id);
  const head = await findVersion(db, eq(pageVersions.id, page.headVersionId));
  return { ...toSummary(page), head: head! };
}

/** 本文中の `/p/{id}` 形式の内部リンクを抽出する。 */
export function extractPageLinks(bodyMd: string): string[] {
  const ids = new Set<string>();
  for (const m of bodyMd.matchAll(/\/p\/([0-9a-z]{10})(?![0-9a-z])/g)) ids.add(m[1]!);
  return [...ids];
}

/** 別の wiki のページへのリンクは外部リンクと同じ扱いにし、ここには残さない。 */
async function replaceLinks(db: Db, wikiId: string, pageId: string, bodyMd: string) {
  await db.delete(pageLinks).where(eq(pageLinks.fromPageId, pageId));
  const linked = extractPageLinks(bodyMd).filter((id) => id !== pageId);
  const foreign = new Set(
    linked.length === 0
      ? []
      : (await db.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, linked), ne(pages.wikiId, wikiId)))).map((p) => p.id),
  );
  const targets = linked.filter((id) => !foreign.has(id));
  if (targets.length > 0) {
    await db.insert(pageLinks).values(targets.map((toPageId) => ({ fromPageId: pageId, toPageId })));
  }
}

/** ページを作り、指定された親ページの下（無ければ最上位）の末尾に置く。トランザクション内で呼ぶ。 */
export async function createPage(
  tx: Db,
  wikiId: string,
  input: { title: string; bodyMd: string; parentPageId?: string | null },
  opts: {
    /** 作った人（版と構造の履歴に残す）。シードなど人の操作でなければ無し */
    createdBy?: string | null;
    oauthGrantId?: string;
  } = {},
): Promise<string> {
  const id = newPageId();
  const versionId = crypto.randomUUID();
  await tx.insert(pages).values({ id, wikiId, title: input.title, headVersionId: versionId });
  await tx.insert(pageVersions).values({
    id: versionId,
    pageId: id,
    title: input.title,
    bodyMd: input.bodyMd,
    authorType: "human",
    createdBy: opts.createdBy ?? null,
    oauthGrantId: opts.oauthGrantId ?? null,
  });
  await replaceLinks(tx, wikiId, id, input.bodyMd);
  await commitOps(tx, wikiId, {
    createdBy: opts.createdBy ?? null,
    message: `「${input.title}」を追加`,
    ops: [{ type: "add_to_tree", treeId: (await getPrimaryTree(tx, wikiId)).id, pageId: id, parentNodeId: input.parentPageId ?? null }],
    oauthGrantId: opts.oauthGrantId,
  });
  return id;
}

/**
 * 本文の保存（楽観ロック：baseVersionId が head と一致する場合のみ）。トランザクション内で呼ぶ。
 * `canEdit` はページを行ロックしたあとに呼び、false ならそのページは無いものとして扱う。
 */
export async function savePage(
  tx: Db,
  wikiId: string,
  id: string,
  input: SavePageInput,
  opts: {
    /** 保存した人（版の履歴に残す） */
    createdBy: string;
    oauthGrantId?: string;
    /** 版として残したら要らなくなる下書きの持ち主（管理画面から保存した人） */
    draftOwner?: string;
  },
): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  // 楽観ロック：別タブ等で先に保存されていたら保存しない
  if (page.headVersionId !== input.baseVersionId) {
    throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
      headVersionId: page.headVersionId,
    });
  }
  // 版として残したら、自分の下書きは要らない（変更が無く版を作らないときも、下書きは head と同じなので消す）
  if (opts.draftOwner) await tx.delete(pageDrafts).where(ownDraft(id, opts.draftOwner));
  const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  if (head!.title === input.title && head!.bodyMd === input.bodyMd) return;

  const [version] = await tx
    .insert(pageVersions)
    .values({
      pageId: id,
      baseVersionId: input.baseVersionId,
      title: input.title,
      bodyMd: input.bodyMd,
      authorType: "human",
      createdBy: opts.createdBy,
      oauthGrantId: opts.oauthGrantId ?? null,
    })
    .returning();
  await tx
    .update(pages)
    .set({ title: input.title, headVersionId: version!.id, updatedAt: new Date() })
    .where(eq(pages.id, id));
  await replaceLinks(tx, wikiId, id, input.bodyMd);
}

/** ページの削除（ツリーから外し、予約を取り消す）。監査ログに残す。トランザクション内で呼ぶ。 */
export async function deletePage(tx: Db, wikiId: string, id: string, opts: { actor: AuditActor; oauthGrantId?: string }): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  const main = await getBranch(tx, wikiId, MAIN_BRANCH);
  const ops = opsToRemovePage((await loadCommit(tx, main.headCommitId)).state, id);
  if (ops.length > 0) {
    await commitOps(tx, wikiId, {
      message: `「${page.title}」の削除に伴いツリーから外す`,
      ops,
      checkVisibility: false,
      createdBy: actorUserId(opts.actor),
      oauthGrantId: opts.oauthGrantId,
    });
  }
  await tx
    .update(pages)
    .set({ deletedAt: new Date(), updatedAt: new Date(), publishedVersionId: null, visibility: "private" })
    .where(eq(pages.id, id));
  // 予約は無効にする。公開済みだった記事は再ビルドで410になる
  await tx
    .update(scheduledActions)
    .set({ status: "canceled", lastError: "page deleted" })
    .where(and(eq(scheduledActions.pageId, id), eq(scheduledActions.status, "scheduled")));
  if (page.firstPublishedAt) await recordPublishEvent(tx, wikiId, "delete", { pageId: id, oauthGrantId: opts.oauthGrantId });
  await writeAudit(tx, { wikiId, actor: opts.actor, action: "page_delete", target: { type: "page", id, label: page.title }, detail: {} });
}

/** 記事の状態（ネタ・下書き・承認済み）を変える。承認はその版を固定する。トランザクション内で呼ぶ。 */
export async function setWorkflow(tx: Db, wikiId: string, id: string, input: SetWorkflowInput, actor: AuditActor): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  if (input.state === "approved") {
    const [v] = await tx
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, id)));
    if (!v) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
  }
  // 一覧の並び（updated_at）は変えない。approved_at は予約の created_at と比べるので、同じDBの時計で入れる
  await tx
    .update(pages)
    .set(
      input.state === "approved"
        ? { workflowState: "approved", approvedVersionId: input.versionId, approvedAt: sql`clock_timestamp()` }
        : { workflowState: input.state, approvedVersionId: null, approvedAt: null },
    )
    .where(eq(pages.id, id));
  // 監査ログに残すのは承認と、承認の取り消し（ネタ・下書きのあいだの移り変わりは残さない）
  const target = { type: "page" as const, id, label: page.title };
  if (input.state === "approved") {
    await writeAudit(tx, { wikiId, actor, action: "page_approve", target, detail: { versionId: input.versionId } });
  } else if (page.workflowState === "approved") {
    await writeAudit(tx, { wikiId, actor, action: "page_unapprove", target, detail: { to: input.state } });
  }
}

export const pageRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const q = c.req.query("q")?.trim();
    const live = and(eq(pages.wikiId, c.get("wiki").id), isNull(pages.deletedAt));
    const where = q ? and(live, ilike(pages.title, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)) : live;
    const rows = await db.select().from(pages).where(where).orderBy(desc(pages.updatedAt)).limit(500);
    return c.json({ pages: rows.map(toSummary) });
  })
  .post("/", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, createPageInput);
    const wikiId = c.get("wiki").id;
    const id = await db.transaction(async (tx) => {
      const userId = c.get("user").id;
      if (input.templateId === undefined) return createPage(tx, wikiId, { ...input, title: input.title! }, { createdBy: userId });
      // テンプレートから作る：変数を置き換えた本文で始める。タイトルの指定が無ければテンプレートのタイトルにする
      const filled = renderTemplate(await findTemplate(tx, wikiId, input.templateId), c.get("user").email);
      return createPage(tx, wikiId, { title: input.title ?? filled.title, bodyMd: filled.bodyMd, parentPageId: input.parentPageId }, { createdBy: userId });
    });
    return c.json(await getDetail(db, wikiId, id), 201);
  })
  .get("/:id", async (c) => {
    const { db } = c.get("deps");
    return c.json(await getDetail(db, c.get("wiki").id, c.req.param("id")));
  })
  .put("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const input = await parseJson(c, savePageInput);
    await db.transaction((tx) => savePage(tx, wikiId, id, input, { draftOwner: c.get("user").id, createdBy: c.get("user").id }));
    return c.json(await getDetail(db, wikiId, id));
  })
  .get("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findLivePage(db, c.get("wiki").id, id);
    const [draft] = await db.select().from(pageDrafts).where(ownDraft(id, c.get("user").id));
    return c.json({ draft: draft ? toDraft(draft) : null });
  })
  .put("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const userId = c.get("user").id;
    const input = await parseJson(c, savePageDraftInput);
    const draft = await db.transaction(async (tx) => {
      const page = await findLivePage(tx, c.get("wiki").id, id, true);
      // 別のタブや人が先に版を作っていたら、その版を知らないまま書いた下書きでは上書きしない
      if (page.headVersionId !== input.baseVersionId) {
        throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
          headVersionId: page.headVersionId,
        });
      }
      // head と同じ内容に戻したら、下書きは無いのと同じ
      const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
      if (head!.title === input.title && head!.bodyMd === input.bodyMd) {
        await tx.delete(pageDrafts).where(ownDraft(id, userId));
        return null;
      }
      const values = { baseVersionId: input.baseVersionId, title: input.title, bodyMd: input.bodyMd, updatedAt: new Date() };
      const [row] = await tx
        .insert(pageDrafts)
        .values({ pageId: id, userId, ...values })
        .onConflictDoUpdate({ target: [pageDrafts.pageId, pageDrafts.userId], set: values })
        .returning();
      return toDraft(row!);
    });
    return c.json({ draft });
  })
  .delete("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findLivePage(db, c.get("wiki").id, id);
    await db.delete(pageDrafts).where(ownDraft(id, c.get("user").id));
    return c.json({ draft: null });
  })
  .delete("/:id", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    await db.transaction((tx) => deletePage(tx, wikiId, c.req.param("id"), { actor: auditActor(c) }));
    return c.json({ ok: true });
  })
  .post("/:id/workflow", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const input = await parseJson(c, setWorkflowInput);
    await db.transaction((tx) => setWorkflow(tx, wikiId, id, input, auditActor(c)));
    return c.json(await getDetail(db, wikiId, id));
  })
  .post("/:id/review-done", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    await findLivePage(db, wikiId, id);
    await db.update(pages).set({ reviewRequestedAt: null, reviewedAt: new Date() }).where(eq(pages.id, id));
    return c.json(await getDetail(db, wikiId, id));
  })
  .get("/:id/versions", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    await findLivePage(db, wikiId, id);
    const rows = await db
      .select({
        id: pageVersions.id,
        baseVersionId: pageVersions.baseVersionId,
        title: pageVersions.title,
        authorType: pageVersions.authorType,
        createdAt: pageVersions.createdAt,
        createdById: pageVersions.createdBy,
        createdByName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        // 外部のアプリ（MCP）から保存した版なら、そのアプリの名前
        via: oauthClients.name,
      })
      .from(pageVersions)
      .leftJoin(users, eq(users.id, pageVersions.createdBy))
      .leftJoin(oauthGrants, eq(oauthGrants.id, pageVersions.oauthGrantId))
      .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(eq(pageVersions.pageId, id))
      .orderBy(desc(pageVersions.createdAt));
    return c.json({
      versions: rows.map(({ createdById, createdByName, ...r }) => ({
        ...r,
        createdBy: createdById && createdByName ? { id: createdById, name: createdByName } : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
  .get("/:id/versions/:versionId", async (c) => {
    const { db } = c.get("deps");
    const versionId = c.req.param("versionId");
    if (!/^[0-9a-f-]{36}$/.test(versionId)) throw notFound("version");
    await findLivePage(db, c.get("wiki").id, c.req.param("id"));
    const v = await findVersion(db, and(eq(pageVersions.pageId, c.req.param("id")), eq(pageVersions.id, versionId))!);
    if (!v) throw notFound("version");
    return c.json(v);
  });
