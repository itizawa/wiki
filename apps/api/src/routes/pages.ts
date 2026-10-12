import {
  createPageInput,
  newPageId,
  savePageDraftInput,
  savePageInput,
  setPageIconInput,
  setPageCoverInput,
  type PageDetail,
  type PageDraft,
  type PageSummary,
  type SavePageDraftResult,
  type PageVersion,
  type PageVersionList,
  type SavePageInput,
  type StructureOp,
  type TrashedPage,
} from "@wiki/shared";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { editRequestComments, editRequestItems, editRequests, oauthClients, oauthGrants, pageDrafts, pageLinks, pages, pageSearch, pageStars, pageVersions, scheduledActions, users } from "../db/schema";
import { createVersion, DRAFT_IDLE_MS, DRAFT_MAX_AGE_MS, isOwnAutoVersion, ownDraft, replaceLinks, syncPageSearch } from "../pages/versions";
import { markCronWork } from "../cron/marks";
import { descendantIds, indexNodes } from "../publishing/hierarchy";
import { recordPublishEvent, recordPublishEvents } from "../publishing/service";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { changeStructure, getPrimaryTree, loadStructure, lockStructure, opsToRemovePages } from "../structure/repo";
import { parseJson } from "../validation";
import { findTemplate, renderTemplate } from "./templates";
import { auditActor, writeAudit, type AuditActor } from "../audit/service";

type PageRow = typeof pages.$inferSelect;
type VersionRow = typeof pageVersions.$inferSelect;
type DraftRow = typeof pageDrafts.$inferSelect;

const toSummary = (p: PageRow): PageSummary => ({
  id: p.id,
  title: p.title,
  icon: p.icon,
  cover: p.cover,
  headVersionId: p.headVersionId,
  publishedVersionId: p.publishedVersionId,
  visibility: p.visibility,
  origin: p.origin,
  unlistedKey: p.unlistedKey,
  firstPublishedAt: p.firstPublishedAt?.toISOString() ?? null,
  updatedAt: p.updatedAt.toISOString(),
});

const toVersion = (v: VersionRow, author: { name: string | null; email: string } | null, acceptedItems: number): PageVersion => ({
  id: v.id,
  pageId: v.pageId,
  baseVersionId: v.baseVersionId,
  title: v.title,
  bodyMd: v.bodyMd,
  authorType: v.authorType,
  createdBy: v.createdBy && author ? { id: v.createdBy, name: author.name ?? author.email } : null,
  keep: v.keep,
  acceptedItems,
  createdAt: v.createdAt.toISOString(),
});

/** その版が、編集リクエストの提案を採用してできたものなら、採用した項目の数（そうでなければ 0）。 */
const acceptedItemCount = sql<number>`(
  select count(*)::int from "edit_request_items" i where i."accepted_version_id" = "page_versions"."id"
)`;

/** 版と、それを作った人（いまの名前）。 */
async function findVersion(db: Db, where: ReturnType<typeof eq>): Promise<PageVersion | null> {
  const [row] = await db
    .select({ version: pageVersions, name: users.name, email: users.email, acceptedItems: acceptedItemCount })
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.createdBy))
    .where(where);
  return row ? toVersion(row.version, row.email === null ? null : { name: row.name, email: row.email }, Number(row.acceptedItems)) : null;
}

const toDraft = (d: DraftRow): PageDraft => ({
  baseVersionId: d.baseVersionId,
  title: d.title,
  bodyMd: d.bodyMd,
  updatedAt: d.updatedAt.toISOString(),
});

/** 一覧を続きから取るときの、1回の件数。 */
const PAGE_LIMIT_DEFAULT = 50;
const PAGE_LIMIT_MAX = 100;

/** `limit` を 1〜100 に丸める。数でなければ既定の件数にする。 */
export function clampPageLimit(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n)) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(n, 1), PAGE_LIMIT_MAX);
}

/** 一覧の続きの位置。最後に返した行の日時（ページは更新日時、版は作った日時。DB の文字のまま）と id。 */
export type ListCursor = { at: string; id: string };

export const encodeCursor = (cursor: ListCursor): string =>
  btoa(JSON.stringify([cursor.at, cursor.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 壊れたカーソルは 400 にする（DB に渡してから失敗させない）。`idPattern` は、その一覧の id の形。 */
export function decodeCursor(value: string, idPattern?: RegExp): ListCursor {
  try {
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [at, id] = parsed as unknown[];
      if (
        typeof at === "string" &&
        typeof id === "string" &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(at) &&
        (idPattern?.test(id) ?? true)
      ) {
        return { at, id };
      }
    }
  } catch {
    // 下で 400 にする
  }
  throw new HttpError(400, "invalid_cursor", "the cursor is not valid; load the list from the start");
}

const UUID_PATTERN = /^[0-9a-f-]{36}$/;

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

/** ページを作り、指定された親ページの下（無ければ最上位）の末尾に置く。トランザクション内で呼ぶ。 */
export async function createPage(
  tx: Db,
  wikiId: string,
  input: { title: string; bodyMd: string; parentPageId?: string | null; icon?: string | null; cover?: string | null },
  opts: {
    /** 作った人（版に残す）。シードなど人の操作でなければ無し */
    createdBy?: string | null;
    oauthGrantId?: string;
  } = {},
): Promise<string> {
  const id = newPageId();
  const versionId = crypto.randomUUID();
  await tx.insert(pages).values({ id, wikiId, title: input.title, icon: input.icon ?? null, cover: input.cover ?? null, headVersionId: versionId });
  await tx.insert(pageVersions).values({
    id: versionId,
    pageId: id,
    title: input.title,
    bodyMd: input.bodyMd,
    authorType: "human",
    createdBy: opts.createdBy ?? null,
    oauthGrantId: opts.oauthGrantId ?? null,
  });
  await syncPageSearch(tx, id, input);
  await replaceLinks(tx, wikiId, id, input.bodyMd);
  await changeStructure(tx, wikiId, {
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
    /** 保存した人（版の履歴に残す） */
    createdBy: string;
    oauthGrantId?: string;
    /**
     * 管理画面から保存した人（ユーザーの ID）。版になったらこの人の下書きを消す。
     * 自分の下書きからワーカーが作った版の上には、古い baseVersionId のままでも保存できる
     */
    draftOwner?: string;
  },
): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  // 楽観ロック：別タブ等で先に保存されていたら保存しない。自分の下書きからワーカーが作った版は、先に保存されたうちに入れない
  if (page.headVersionId !== input.baseVersionId) {
    const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
    if (!opts.draftOwner || !isOwnAutoVersion(head!, opts.draftOwner, input.baseVersionId)) {
      throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
        headVersionId: page.headVersionId,
      });
    }
  }
  await createVersion(tx, page, input, {
    keep: true,
    createdBy: opts.createdBy,
    oauthGrantId: opts.oauthGrantId,
    draftOwner: opts.draftOwner,
  });
}

/**
 * アイコン（絵文字1つ）を付ける・変える・外す（null）。版は作らず、すぐに反映する。
 * 公開中・限定公開中のページなら、公開サイトにも出るので、ビルドし直すきっかけを残す。
 * 一覧の並び（updated_at）は変えない。トランザクション内で呼ぶ。
 */
export async function setPageIcon(tx: Db, wikiId: string, id: string, icon: string | null): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  if (page.icon === icon) return;
  await tx.update(pages).set({ icon }).where(eq(pages.id, id));
  if (page.publishedVersionId !== null && page.visibility !== "private") await recordPublishEvent(tx, wikiId, "icon", { pageId: id });
}

/**
 * カバー画像を付ける・変える・外す（null）。アイコンと同じく、版は作らずにすぐ反映する。
 * 公開中・限定公開中のページなら、公開サイトにも出るので、ビルドし直すきっかけを残す。
 * 一覧の並び（updated_at）は変えない。トランザクション内で呼ぶ。
 */
export async function setPageCover(tx: Db, wikiId: string, id: string, cover: string | null): Promise<void> {
  const page = await findLivePage(tx, wikiId, id, true);
  if (page.cover === cover) return;
  await tx.update(pages).set({ cover }).where(eq(pages.id, id));
  if (page.publishedVersionId !== null && page.visibility !== "private") await recordPublishEvent(tx, wikiId, "cover", { pageId: id });
}

/**
 * ページの削除 = ゴミ箱に入れる。選んだページと配下のページをまとめてツリーから外し、公開をやめ、予約を取り消す。
 * いっしょに入れたページは1つのまとまり（trash_root_id）になり、元に戻す・完全に削除するのはまとまりごと。
 * 先にゴミ箱に入れてあった配下のページは、別のまとまりのまま残る。監査ログに残す。トランザクション内で呼ぶ。
 */
export async function deletePage(
  tx: Db,
  wikiId: string,
  id: string,
  opts: { actor: AuditActor; oauthGrantId?: string },
): Promise<{ trashedPageIds: string[] }> {
  const page = await findLivePage(tx, wikiId, id, true);
  // 配下を読んだあとにツリーが変わらないよう、先に wiki をロックする（配下に足されたページを取りこぼさない）
  await lockStructure(tx, wikiId);
  const state = await loadStructure(tx, wikiId);
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
    await changeStructure(tx, wikiId, {
      ops,
      checkVisibility: false,
      oauthGrantId: opts.oauthGrantId,
    });
  }
  if (members.length > 0) {
    // ページごとに違うのは、ゴミ箱に入れる前の親と並びだけ。(ページ, 親, 並び) の組を渡して、1回で更新する
    const now = new Date().toISOString();
    const values = sql.join(
      members.map((m) => {
        const node = nodeOf.get(m.id);
        return sql`(${m.id}::text, ${node?.parentNodeId ?? null}::text, ${node?.position ?? null}::text)`;
      }),
      sql`, `,
    );
    await tx.execute(sql`
      update "pages" p
      set "deleted_at" = ${now}::timestamptz,
          "updated_at" = ${now}::timestamptz,
          "published_version_id" = null,
          "visibility" = 'private',
          "trash_root_id" = ${id}::text,
          "trashed_parent_id" = v."parent_id",
          "trashed_position" = v."position"
      from (values ${values}) as v("id", "parent_id", "position")
      where p."id" = v."id"
    `);
  }
  // 予約は無効にする。公開済みだった記事は再ビルドで410になる
  await tx
    .update(scheduledActions)
    .set({ status: "canceled", lastError: "page deleted" })
    .where(and(inArray(scheduledActions.pageId, ids), eq(scheduledActions.status, "scheduled")));
  await recordPublishEvents(
    tx,
    wikiId,
    "delete",
    members.filter((m) => m.firstPublishedAt).map((m) => m.id),
    { oauthGrantId: opts.oauthGrantId },
  );
  await writeAudit(tx, {
    wikiId,
    actor: opts.actor,
    action: "page_delete",
    target: { type: "page", id, label: page.title },
    detail: members.length > 1 ? { descendants: members.length - 1 } : {},
  });
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
 * 公開と予約は戻さない（非公開のまま）。
 * トランザクション内で呼ぶ。
 */
export async function restorePage(
  tx: Db,
  wikiId: string,
  id: string,
  opts: { actor: AuditActor; oauthGrantId?: string },
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

  const tree = await getPrimaryTree(tx, wikiId);
  const placed = new Set(((await loadStructure(tx, wikiId)).trees[tree.id]?.nodes ?? []).map((n) => n.pageId));
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
  await changeStructure(tx, wikiId, {
    ops,
    checkVisibility: false,
    oauthGrantId: opts.oauthGrantId,
  });
  // 公開したことがあるページは、公開サイトで 410 を返すのをやめる（非公開なので 404 になる）
  await recordPublishEvents(
    tx,
    wikiId,
    "restore",
    members.filter((m) => m.firstPublishedAt).map((m) => m.id),
    { oauthGrantId: opts.oauthGrantId },
  );
  await writeAudit(tx, {
    wikiId,
    actor: opts.actor,
    action: "page_restore",
    target: { type: "page", id, label: root.title },
    detail: ids.length > 1 ? { descendants: ids.length - 1 } : {},
  });
  return { restoredPageIds: ids, parentPageId, parentMissing: root.trashedParentId !== null && parentPageId === null };
}

/**
 * ゴミ箱のページを、いっしょに入れた配下ごと完全に削除する。元に戻せない。
 * 版・下書き・リンク・スター・予約・編集リクエストと、検索用の本文の写しを消す。pages の行は残す：公開したことがあるページを公開サイトで 410 にし続けるためと、
 *監査ログに残す。トランザクション内で呼ぶ。
 */
export async function purgePage(tx: Db, wikiId: string, id: string, opts: { actor: AuditActor }): Promise<{ purgedPageIds: string[] }> {
  const { root, members } = await lockTrashGroup(tx, wikiId, id);
  const ids = members.map((m) => m.id);
  // 予約は版を指しているので、版より先に消す
  await tx.delete(scheduledActions).where(inArray(scheduledActions.pageId, ids));
  await tx.delete(pageDrafts).where(inArray(pageDrafts.pageId, ids));
  await tx.delete(pageLinks).where(or(inArray(pageLinks.fromPageId, ids), inArray(pageLinks.toPageId, ids)));
  await tx.delete(pageStars).where(inArray(pageStars.pageId, ids));
  // 編集リクエストの項目は版を指しているので、版より先に消す
  const requestIds = tx.select({ id: editRequests.id }).from(editRequests).where(inArray(editRequests.pageId, ids));
  // 返信は項目を指しているので、項目より先に消す
  const itemIds = tx.select({ id: editRequestItems.id }).from(editRequestItems).where(inArray(editRequestItems.requestId, requestIds));
  await tx.delete(editRequestComments).where(inArray(editRequestComments.itemId, itemIds));
  await tx.delete(editRequestItems).where(inArray(editRequestItems.requestId, requestIds));
  await tx.delete(editRequests).where(inArray(editRequests.pageId, ids));
  await tx.delete(pageVersions).where(inArray(pageVersions.pageId, ids));
  await tx.delete(pageSearch).where(inArray(pageSearch.pageId, ids));
  await tx
    .update(pages)
    .set({
      purgedAt: new Date(),
      trashRootId: null,
      trashedParentId: null,
      trashedPosition: null,
      unlistedKey: null,
    })
    .where(inArray(pages.id, ids));
  await writeAudit(tx, {
    wikiId,
    actor: opts.actor,
    action: "page_purge",
    target: { type: "page", id, label: root.title },
    detail: ids.length > 1 ? { descendants: ids.length - 1 } : {},
  });
  return { purgedPageIds: ids };
}

export const pageRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const q = c.req.query("q")?.trim();
    const live = and(eq(pages.wikiId, c.get("wiki").id), isNull(pages.deletedAt));
    const where = q ? and(live, ilike(pages.title, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)) : live;
    const order = [desc(pages.updatedAt), desc(pages.id)];
    const limitParam = c.req.query("limit");
    const cursorParam = c.req.query("cursor");
    // どちらも無ければ、続きを取らない呼び出し（検索・コマンドメニュー・編集カレンダーなど）。最大500件を一度に返す
    if (limitParam === undefined && cursorParam === undefined) {
      const rows = await db.select().from(pages).where(where).orderBy(...order).limit(500);
      return c.json({ pages: rows.map(toSummary) });
    }
    const limit = clampPageLimit(limitParam);
    const after = cursorParam === undefined ? null : decodeCursor(cursorParam);
    // 続きは「最後の行より後ろ」。更新日時が同じ行は id で順を決めるので、抜けも重なりも出ない
    const rest = after ? sql`(${pages.updatedAt}, ${pages.id}) < (${after.at}::timestamptz, ${after.id})` : undefined;
    const rows = await db
      // 日時はマイクロ秒まで持っている。Date にするとミリ秒に丸まり、同じミリ秒の行を取りこぼすので、カーソルには文字のまま使う
      .select({ page: pages, updatedAtText: sql<string>`${pages.updatedAt}::text` })
      .from(pages)
      .where(and(where, rest))
      .orderBy(...order)
      // 1件多く取って、続きがあるかを見る
      .limit(limit + 1);
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    return c.json({
      pages: shown.map((r) => toSummary(r.page)),
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.updatedAtText, id: last.page.id }) : null,
    });
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
      return createPage(
        tx,
        wikiId,
        { title: input.title ?? filled.title, bodyMd: filled.bodyMd, parentPageId: input.parentPageId, icon: input.icon, cover: input.cover },
        { createdBy: userId },
      );
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
    await db.transaction((tx) => savePage(tx, wikiId, id, input, { draftOwner: c.get("user").id, createdBy: c.get("user").id }));
    return c.json(await getDetail(db, wikiId, id));
  })
  // アイコン（絵文字1つ）。本文の保存とは別に、選んだらすぐに反映する
  .put("/:id/icon", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const { icon } = await parseJson(c, setPageIconInput);
    await db.transaction((tx) => setPageIcon(tx, wikiId, id, icon));
    return c.json(await getDetail(db, wikiId, id));
  })
  // カバー画像。アイコンと同じく、選んだらすぐに反映する
  .put("/:id/cover", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const { cover } = await parseJson(c, setPageCoverInput);
    await db.transaction((tx) => setPageCover(tx, wikiId, id, cover));
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
    const result = await db.transaction(async (tx) => {
      const page = await findLivePage(tx, c.get("wiki").id, id, true);
      const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
      // 別のタブや人が先に版を作っていたら、その版を知らないまま書いた下書きでは上書きしない。
      // 自分の下書きからワーカーが作った版は別で、開いたままの画面で続きを打てるよう、head をもとにした下書きとして受け取る
      if (page.headVersionId !== input.baseVersionId && !isOwnAutoVersion(head!, userId, input.baseVersionId)) {
        throw new HttpError(409, "version_conflict", "this page was saved elsewhere; reload to continue", {
          headVersionId: page.headVersionId,
        });
      }
      // head と同じ内容に戻したら、下書きは無いのと同じ
      if (head!.title === input.title && head!.bodyMd === input.bodyMd) {
        await tx.delete(pageDrafts).where(ownDraft(id, userId));
        return { draft: null, headVersionId: page.headVersionId };
      }
      const now = new Date();
      const values = { baseVersionId: page.headVersionId, title: input.title, bodyMd: input.bodyMd, updatedAt: now };
      // 始めた時刻（created_at）は、行を新しく作るときだけ入れる。上書きでは変えない
      const [row] = await tx
        .insert(pageDrafts)
        .values({ pageId: id, userId, createdAt: now, ...values })
        .onConflictDoUpdate({ target: [pageDrafts.pageId, pageDrafts.userId], set: values })
        .returning();
      // いちばん早く版にできる時刻：最後の保存から5分か、始めてから30分の早い方
      markCronWork("drafts", new Date(Math.min(row!.updatedAt.getTime() + DRAFT_IDLE_MS, row!.createdAt.getTime() + DRAFT_MAX_AGE_MS)));
      return { draft: toDraft(row!), headVersionId: page.headVersionId };
    });
    // いまの head も返す。ワーカーが版を作っていたら、画面はここで気づいて追いかける
    return c.json(result satisfies SavePageDraftResult);
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
    const { trashedPageIds } = await db.transaction((tx) => deletePage(tx, wikiId, c.req.param("id"), { actor: auditActor(c) }));
    return c.json({ ok: true, trashedPages: trashedPageIds.length });
  })
  // ゴミ箱から元に戻す（配下ごと）
  .post("/:id/restore", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    const { restoredPageIds, ...placed } = await db.transaction((tx) => restorePage(tx, wikiId, id, { actor: auditActor(c) }));
    return c.json({ id, restoredPages: restoredPageIds.length, ...placed });
  })
  // ゴミ箱から完全に削除する（配下ごと。元に戻せない）
  .delete("/:id/trash", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const { purgedPageIds } = await db.transaction((tx) => purgePage(tx, wikiId, c.req.param("id"), { actor: auditActor(c) }));
    return c.json({ ok: true, purgedPages: purgedPageIds.length });
  })
  .get("/:id/versions", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const wikiId = c.get("wiki").id;
    await findLivePage(db, wikiId, id);
    const limit = clampPageLimit(c.req.query("limit"));
    const cursorParam = c.req.query("cursor");
    const after = cursorParam === undefined ? null : decodeCursor(cursorParam, UUID_PATTERN);
    // 続きは「最後の行より後ろ」。同じトランザクションで作った版は日時が同じになるので、id で順を決める
    const rest = after ? sql`(${pageVersions.createdAt}, ${pageVersions.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined;
    const rows = await db
      .select({
        id: pageVersions.id,
        baseVersionId: pageVersions.baseVersionId,
        title: pageVersions.title,
        authorType: pageVersions.authorType,
        keep: pageVersions.keep,
        createdAt: pageVersions.createdAt,
        // 日時はマイクロ秒まで持っている。カーソルには文字のまま使う（ページの一覧と同じ）
        createdAtText: sql<string>`${pageVersions.createdAt}::text`,
        createdById: pageVersions.createdBy,
        createdByName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
        // 外部のアプリ（MCP）から保存した版なら、そのアプリの名前
        via: oauthClients.name,
        acceptedItems: acceptedItemCount,
      })
      .from(pageVersions)
      .leftJoin(users, eq(users.id, pageVersions.createdBy))
      .leftJoin(oauthGrants, eq(oauthGrants.id, pageVersions.oauthGrantId))
      .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(and(eq(pageVersions.pageId, id), rest))
      .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id))
      // 1件多く取って、続きがあるかを見る
      .limit(limit + 1);
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    return c.json({
      versions: shown.map(({ createdById, createdByName, createdAtText: _, ...r }) => ({
        ...r,
        acceptedItems: Number(r.acceptedItems),
        createdBy: createdById && createdByName ? { id: createdById, name: createdByName } : null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.createdAtText, id: last.id }) : null,
    } satisfies PageVersionList);
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
