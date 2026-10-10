import {
  createPageInput,
  newPageId,
  savePageDraftInput,
  savePageInput,
  setWorkflowInput,
  type PageDetail,
  type PageDraft,
  type PageSummary,
  type SavePageDraftResult,
  type PageVersion,
  type SavePageInput,
  type SetWorkflowInput,
  type StructureOp,
  type TrashedPage,
} from "@wiki/shared";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { oauthClients, oauthGrants, pageDrafts, pageLinks, pages, pageStars, pageVersions, scheduledActions } from "../db/schema";
import { createVersion, isOwnAutoVersion, keepVersion, ownDraft, replaceLinks } from "../pages/versions";
import { descendantIds, indexNodes } from "../publishing/hierarchy";
import { recordPublishEvent } from "../publishing/service";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { commitOps, loadCommit, getBranch, getPrimaryTree, MAIN_BRANCH, opsToRemovePages } from "../structure/repo";
import { parseJson } from "../validation";
import { findTemplate, renderTemplate } from "./templates";

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

const toVersion = (v: VersionRow): PageVersion => ({
  id: v.id,
  pageId: v.pageId,
  baseVersionId: v.baseVersionId,
  title: v.title,
  bodyMd: v.bodyMd,
  authorType: v.authorType,
  keep: v.keep,
  createdAt: v.createdAt.toISOString(),
});

const toDraft = (d: DraftRow): PageDraft => ({
  baseVersionId: d.baseVersionId,
  title: d.title,
  bodyMd: d.bodyMd,
  updatedAt: d.updatedAt.toISOString(),
});

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
  const [head] = await db.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  return { ...toSummary(page), head: toVersion(head!) };
}

/** ページを作り、指定された親ページの下（無ければ最上位）の末尾に置く。トランザクション内で呼ぶ。 */
export async function createPage(
  tx: Db,
  wikiId: string,
  input: { title: string; bodyMd: string; parentPageId?: string | null },
  opts: { oauthGrantId?: string } = {},
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
    oauthGrantId: opts.oauthGrantId ?? null,
  });
  await replaceLinks(tx, wikiId, id, input.bodyMd);
  await commitOps(tx, wikiId, {
    message: `「${input.title}」を追加`,
    ops: [{ type: "add_to_tree", treeId: (await getPrimaryTree(tx, wikiId)).id, pageId: id, parentNodeId: input.parentPageId ?? null }],
    oauthGrantId: opts.oauthGrantId,
  });
  return id;
}

/**
 * 本文の保存（楽観ロック：baseVersionId が head と一致する場合のみ）。人（か外部のアプリ）が操作して作る、残す版になる。
 * トランザクション内で呼ぶ。
 */
export async function savePage(
  tx: Db,
  wikiId: string,
  id: string,
  input: SavePageInput,
  opts: {
    oauthGrantId?: string;
    /** 管理画面から保存した人。版の作者になり、版になったらこの人の下書きを消す */
    authorEmail?: string;
  } = {},
): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  // 楽観ロック：別タブ等で先に保存されていたら保存しない。自分の下書きからワーカーが作った版は、先に保存されたうちに入れない
  if (page.headVersionId !== input.baseVersionId) {
    const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
    if (!opts.authorEmail || !isOwnAutoVersion(head!, opts.authorEmail, input.baseVersionId)) {
      throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
        headVersionId: page.headVersionId,
      });
    }
  }
  await createVersion(tx, page, input, {
    keep: true,
    authorEmail: opts.authorEmail ?? null,
    oauthGrantId: opts.oauthGrantId,
    draftOwner: opts.authorEmail,
  });
}

/**
 * ページの削除 = ゴミ箱に入れる。選んだページと配下のページをまとめてツリーから外し、公開をやめ、予約を取り消す。
 * いっしょに入れたページは1つのまとまり（trash_root_id）になり、元に戻す・完全に削除するのはまとまりごと。
 * 先にゴミ箱に入れてあった配下のページは、別のまとまりのまま残る。トランザクション内で呼ぶ。
 */
export async function deletePage(
  tx: Db,
  wikiId: string,
  id: string,
  opts: { oauthGrantId?: string } = {},
): Promise<{ trashedPageIds: string[] }> {
  const page = await findLivePage(tx, wikiId, id, true);
  const main = await getBranch(tx, wikiId, MAIN_BRANCH);
  const { state } = await loadCommit(tx, main.headCommitId);
  const nodes = state.trees[(await getPrimaryTree(tx, wikiId)).id]?.nodes ?? [];
  const nodeOf = new Map(nodes.map((n) => [n.pageId, n]));
  const ids = [id, ...descendantIds(indexNodes(nodes), id)];
  const members = await tx
    .select({ id: pages.id, firstPublishedAt: pages.firstPublishedAt })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inArray(pages.id, ids), isNull(pages.deletedAt)))
    .for("update");

  const ops = opsToRemovePages(state, new Set(ids));
  if (ops.length > 0) {
    await commitOps(tx, wikiId, {
      // 配下を読んだあとにツリーが変わっていたら、やり直してもらう（配下に足されたページを取りこぼさない）
      expectedHeadCommitId: main.headCommitId,
      message: ids.length > 1 ? `「${page.title}」と配下の ${ids.length - 1} ページをゴミ箱に入れる` : `「${page.title}」をゴミ箱に入れる`,
      ops,
      checkVisibility: false,
      oauthGrantId: opts.oauthGrantId,
    });
  }
  const now = new Date();
  for (const m of members) {
    const node = nodeOf.get(m.id);
    await tx
      .update(pages)
      .set({
        deletedAt: now,
        updatedAt: now,
        publishedVersionId: null,
        visibility: "private",
        trashRootId: id,
        trashedParentId: node?.parentNodeId ?? null,
        trashedPosition: node?.position ?? null,
      })
      .where(eq(pages.id, m.id));
  }
  // 予約は無効にする。公開済みだった記事は再ビルドで410になる
  await tx
    .update(scheduledActions)
    .set({ status: "canceled", lastError: "page deleted" })
    .where(and(inArray(scheduledActions.pageId, ids), eq(scheduledActions.status, "scheduled")));
  for (const m of members) {
    if (m.firstPublishedAt) await recordPublishEvent(tx, wikiId, "delete", { pageId: m.id, oauthGrantId: opts.oauthGrantId });
  }
  return { trashedPageIds: members.map((m) => m.id) };
}

/** ゴミ箱にある（完全には削除していない）ページ */
const inTrash = and(isNotNull(pages.deletedAt), isNull(pages.purgedAt));

/**
 * ゴミ箱の一覧。削除で選んだページ（まとまりの先頭）ごとに1行、ゴミ箱に入れた日時の新しい順。
 * `visible` は、読めるページだけに絞る条件（MCP から使う）。
 */
export async function listTrash(db: Db, wikiId: string, visible?: SQL): Promise<TrashedPage[]> {
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      deletedAt: pages.deletedAt,
      // テーブルが1つの問い合わせでは列名にテーブル名が付かないので、相関する列は名前で書く
      descendantCount: sql<number>`(
        select count(*)::int from "pages" m
        where m."trash_root_id" = "pages"."id" and m."id" <> "pages"."id" and m."deleted_at" is not null and m."purged_at" is null
      )`,
    })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inTrash, eq(pages.trashRootId, pages.id), visible))
    .orderBy(desc(pages.deletedAt), pages.id)
    .limit(500);
  return rows.map((r) => ({ id: r.id, title: r.title, deletedAt: r.deletedAt!.toISOString(), descendantCount: Number(r.descendantCount) }));
}

/**
 * ゴミ箱のまとまりを、先頭のページの ID で引いて行ロックする。
 * ゴミ箱に入っていないページ、ほかの wiki のページ、まとまりの先頭でないページ（配下としていっしょに入ったページ）は、無いものとして扱う。
 */
export async function lockTrashGroup(tx: Db, wikiId: string, id: string): Promise<{ root: PageRow; members: PageRow[] }> {
  const members = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), inTrash, eq(pages.trashRootId, id)))
    .for("update");
  const root = members.find((m) => m.id === id);
  if (!root) throw notFound(`page ${id} in the trash`);
  return { root, members };
}

/**
 * ゴミ箱のページを、いっしょに入れた配下ごと元に戻す。親子関係と並びは削除前のまま。
 * 置き場所は、元の親がツリーに残っていればその下の末尾、無ければ最上位の末尾。
 * 公開と予約は戻さない（非公開のまま）。承認済みだったページは下書きに戻す（戻しただけで、ルールが予約枠に入れないように）。
 * トランザクション内で呼ぶ。
 */
export async function restorePage(
  tx: Db,
  wikiId: string,
  id: string,
  opts: { oauthGrantId?: string } = {},
): Promise<{
  restoredPageIds: string[];
  /** 戻した先の親ページ（nullなら最上位） */
  parentPageId: string | null;
  /** 元の親ページが無くなっていたので、最上位に戻した */
  parentMissing: boolean;
}> {
  const { root, members } = await lockTrashGroup(tx, wikiId, id);
  const ids = members.map((m) => m.id);
  // ツリーに足す操作は、ページが削除されていないことを確かめるので、先にゴミ箱から出す
  await tx
    .update(pages)
    .set({ deletedAt: null, trashRootId: null, trashedParentId: null, trashedPosition: null, updatedAt: new Date() })
    .where(inArray(pages.id, ids));
  await tx
    .update(pages)
    .set({ workflowState: "draft", approvedVersionId: null, approvedAt: null })
    .where(and(inArray(pages.id, ids), eq(pages.workflowState, "approved")));

  const tree = await getPrimaryTree(tx, wikiId);
  const main = await getBranch(tx, wikiId, MAIN_BRANCH);
  const placed = new Set(((await loadCommit(tx, main.headCommitId)).state.trees[tree.id]?.nodes ?? []).map((n) => n.pageId));
  const parentPageId = root.trashedParentId !== null && placed.has(root.trashedParentId) ? root.trashedParentId : null;

  // 親から先に、兄弟は削除前の並び順に足す
  const childrenOf = new Map<string, PageRow[]>();
  for (const m of members) {
    if (m.id === id) continue;
    // 親がまとまりの中に無い行は、先頭のページの下に置く（通常は起きない）
    const parent = m.trashedParentId !== null && ids.includes(m.trashedParentId) ? m.trashedParentId : id;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), m]);
  }
  const byPosition = (a: PageRow, b: PageRow) => {
    const [x, y] = [a.trashedPosition ?? "", b.trashedPosition ?? ""];
    return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
  };
  const ops: StructureOp[] = [{ type: "add_to_tree", treeId: tree.id, pageId: id, parentNodeId: parentPageId }];
  const queue = [id];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of (childrenOf.get(parent) ?? []).sort(byPosition)) {
      ops.push({ type: "add_to_tree", treeId: tree.id, pageId: child.id, parentNodeId: parent });
      queue.push(child.id);
    }
  }
  await commitOps(tx, wikiId, {
    message: ids.length > 1 ? `「${root.title}」と配下の ${ids.length - 1} ページをゴミ箱から元に戻す` : `「${root.title}」をゴミ箱から元に戻す`,
    ops,
    checkVisibility: false,
    oauthGrantId: opts.oauthGrantId,
  });
  // 公開したことがあるページは、公開サイトで 410 を返すのをやめる（非公開なので 404 になる）
  for (const m of members) {
    if (m.firstPublishedAt) await recordPublishEvent(tx, wikiId, "restore", { pageId: m.id, oauthGrantId: opts.oauthGrantId });
  }
  return { restoredPageIds: ids, parentPageId, parentMissing: root.trashedParentId !== null && parentPageId === null };
}

/**
 * ゴミ箱のページを、いっしょに入れた配下ごと完全に削除する。元に戻せない。
 * 版・下書き・リンク・スター・予約を消す。pages の行は残す：公開したことがあるページを公開サイトで 410 にし続けるためと、
 * 構造の履歴（過去のツリー）がこの行を指しているため。閲覧数の行も残す（画面には出ない）。トランザクション内で呼ぶ。
 */
export async function purgePage(tx: Db, wikiId: string, id: string): Promise<{ purgedPageIds: string[] }> {
  const { members } = await lockTrashGroup(tx, wikiId, id);
  const ids = members.map((m) => m.id);
  // 予約は版を指しているので、版より先に消す
  await tx.delete(scheduledActions).where(inArray(scheduledActions.pageId, ids));
  await tx.delete(pageDrafts).where(inArray(pageDrafts.pageId, ids));
  await tx.delete(pageLinks).where(or(inArray(pageLinks.fromPageId, ids), inArray(pageLinks.toPageId, ids)));
  await tx.delete(pageStars).where(inArray(pageStars.pageId, ids));
  await tx.delete(pageVersions).where(inArray(pageVersions.pageId, ids));
  await tx
    .update(pages)
    .set({
      purgedAt: new Date(),
      trashRootId: null,
      trashedParentId: null,
      trashedPosition: null,
      unlistedKey: null,
      workflowState: "draft",
      approvedVersionId: null,
      approvedAt: null,
    })
    .where(inArray(pages.id, ids));
  return { purgedPageIds: ids };
}

/** 記事の状態（ネタ・下書き・承認済み）を変える。承認はその版を固定する。トランザクション内で呼ぶ。 */
export async function setWorkflow(tx: Db, wikiId: string, id: string, input: SetWorkflowInput): Promise<void> {
  await findLivePage(tx, wikiId, id, true);
  if (input.state === "approved") {
    const [v] = await tx
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(and(eq(pageVersions.id, input.versionId), eq(pageVersions.pageId, id)));
    if (!v) throw new HttpError(400, "invalid_version", "the version does not belong to this page");
    // 承認した版は、ルールが予約枠に入れる。自動でできた版でも間引かない
    await keepVersion(tx, input.versionId);
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
      if (input.templateId === undefined) return createPage(tx, wikiId, { ...input, title: input.title! });
      // テンプレートから作る：変数を置き換えた本文で始める。タイトルの指定が無ければテンプレートのタイトルにする
      const filled = renderTemplate(await findTemplate(tx, wikiId, input.templateId), c.get("adminEmail"));
      return createPage(tx, wikiId, { title: input.title ?? filled.title, bodyMd: filled.bodyMd, parentPageId: input.parentPageId });
    });
    return c.json(await getDetail(db, wikiId, id), 201);
  })
  // ゴミ箱の一覧。`/:id` より先に置く
  .get("/trash", async (c) => {
    const { db } = c.get("deps");
    return c.json({ pages: await listTrash(db, c.get("wiki").id) });
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
    await db.transaction((tx) => savePage(tx, wikiId, id, input, { authorEmail: c.get("adminEmail") }));
    return c.json(await getDetail(db, wikiId, id));
  })
  .get("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findLivePage(db, c.get("wiki").id, id);
    const [draft] = await db.select().from(pageDrafts).where(ownDraft(id, c.get("adminEmail")));
    return c.json({ draft: draft ? toDraft(draft) : null });
  })
  .put("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const email = c.get("adminEmail");
    const input = await parseJson(c, savePageDraftInput);
    const result = await db.transaction(async (tx) => {
      const page = await findLivePage(tx, c.get("wiki").id, id, true);
      const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
      // 別のタブや人が先に版を作っていたら、その版を知らないまま書いた下書きでは上書きしない。
      // 自分の下書きからワーカーが作った版は別で、開いたままの画面で続きを打てるよう、head をもとにした下書きとして受け取る
      if (page.headVersionId !== input.baseVersionId && !isOwnAutoVersion(head!, email, input.baseVersionId)) {
        throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
          headVersionId: page.headVersionId,
        });
      }
      // head と同じ内容に戻したら、下書きは無いのと同じ
      if (head!.title === input.title && head!.bodyMd === input.bodyMd) {
        await tx.delete(pageDrafts).where(ownDraft(id, email));
        return { draft: null, headVersionId: page.headVersionId };
      }
      const now = new Date();
      const values = { baseVersionId: page.headVersionId, title: input.title, bodyMd: input.bodyMd, updatedAt: now };
      // 始めた時刻（created_at）は、行を新しく作るときだけ入れる。上書きでは変えない
      const [row] = await tx
        .insert(pageDrafts)
        .values({ pageId: id, authorEmail: email, createdAt: now, ...values })
        .onConflictDoUpdate({ target: [pageDrafts.pageId, pageDrafts.authorEmail], set: values })
        .returning();
      return { draft: toDraft(row!), headVersionId: page.headVersionId };
    });
    // いまの head も返す。ワーカーが版を作っていたら、画面はここで気づいて追いかける
    return c.json(result satisfies SavePageDraftResult);
  })
  .delete("/:id/draft", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findLivePage(db, c.get("wiki").id, id);
    await db.delete(pageDrafts).where(ownDraft(id, c.get("adminEmail")));
    return c.json({ draft: null });
  })
  .delete("/:id", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const { trashedPageIds } = await db.transaction((tx) => deletePage(tx, wikiId, c.req.param("id")));
    return c.json({ ok: true, trashedPages: trashedPageIds.length });
  })
  // ゴミ箱から元に戻す（配下ごと）
  .post("/:id/restore", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const { restoredPageIds, ...placed } = await db.transaction((tx) => restorePage(tx, wikiId, id));
    return c.json({ id, restoredPages: restoredPageIds.length, ...placed });
  })
  // ゴミ箱から完全に削除する（配下ごと。元に戻せない）
  .delete("/:id/trash", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const { purgedPageIds } = await db.transaction((tx) => purgePage(tx, wikiId, c.req.param("id")));
    return c.json({ ok: true, purgedPages: purgedPageIds.length });
  })
  .post("/:id/workflow", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const input = await parseJson(c, setWorkflowInput);
    await db.transaction((tx) => setWorkflow(tx, wikiId, id, input));
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
        keep: pageVersions.keep,
        createdAt: pageVersions.createdAt,
        // 外部のアプリ（MCP）から保存した版なら、そのアプリの名前
        via: oauthClients.name,
      })
      .from(pageVersions)
      .leftJoin(oauthGrants, eq(oauthGrants.id, pageVersions.oauthGrantId))
      .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(eq(pageVersions.pageId, id))
      .orderBy(desc(pageVersions.createdAt));
    return c.json({ versions: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
  })
  .get("/:id/versions/:versionId", async (c) => {
    const { db } = c.get("deps");
    const versionId = c.req.param("versionId");
    if (!/^[0-9a-f-]{36}$/.test(versionId)) throw notFound("version");
    await findLivePage(db, c.get("wiki").id, c.req.param("id"));
    const [v] = await db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, c.req.param("id")), eq(pageVersions.id, versionId)));
    if (!v) throw notFound("version");
    return c.json(toVersion(v));
  });
