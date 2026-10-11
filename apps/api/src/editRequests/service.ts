import {
  applyLineEdits,
  bodyLines,
  locateLineEdit,
  replacementLines,
  sliceLines,
  EDIT_REQUEST_LIMITS,
  type AcceptEditRequestResult,
  type AppliedEditRequests,
  type CreateEditRequestInput,
  type EditRequest,
  type EditRequestComment,
  type EditRequestItem,
  type EditRequestList,
  type EditRequestListItem,
  type EditRequestListStatus,
  type EditRequestPerson,
  type EditRequestSkipped,
  type LineEdit,
  type PageEditRequests,
} from "@wiki/shared";
import { and, asc, desc, eq, exists, inArray, isNull, not, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { editRequestComments, editRequestItems, editRequests, oauthClients, oauthGrants, pageDrafts, pages, pageVersions, users } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { createVersion } from "../pages/versions";
import { encodeCursor, findLivePage, type ListCursor } from "../routes/pages";

/**
 * 編集リクエストの処理。管理画面の API（`routes/editRequests.ts`）と MCP の道具（`mcp/tools.ts`）が、どちらもここを通る。
 * 行の数え方と置き換えは `@wiki/shared` の `bodyLines` / `applyLineEdits`（管理画面も同じものを使う）。
 *
 * どの関数も、ページがその wiki のもので、ゴミ箱に入っていないことを `findLivePage` で確かめる
 * （アーカイブ中の wiki は、呼ぶ側が `findOpenWiki` で弾いている）。
 */

type PageRow = typeof pages.$inferSelect;
type ItemRow = typeof editRequestItems.$inferSelect;

/** 1ページの一覧で返すリクエストの数の上限（新しい順）。 */
export const EDIT_REQUEST_LIST_LIMIT = 100;
/** 「採用でできた版の置き換え」をさかのぼる版の数の上限。 */
const APPLIED_WALK_LIMIT = 50;

const personName = sql<string>`coalesce(${users.name}, ${users.email})`;

/** 操作した人。外部のアプリ（MCP）からなら、許可した人と、その連携 */
export type EditRequestActor = { userId: string; oauthGrantId?: string };

// ---------------------------------------------------------------------------
// 出す
// ---------------------------------------------------------------------------

/**
 * 編集リクエストを作る。**検査と上限は、ここ（と入力のスキーマ `createEditRequestInput`）にまとめてある**。
 * MCP の `create_edit_request` も、管理画面から出す API も、これを呼ぶ。トランザクション内で呼ぶ。
 *
 * - 基準の版が最新の版でなければ 409（`version_conflict`。読み直してから出し直す）
 * - 行の範囲が本文の外なら 400（`line_out_of_range`）
 * - 提案の置き換え案が元の文面と同じなら 400（`no_change`）。指摘（`kind: "note"`）は置き換え案を持たないので、確かめない
 * - 元の文面は、ここで基準の版から切り出す（呼ぶ側には渡させない）
 */
export async function createEditRequest(
  tx: Db,
  args: { wikiId: string; pageId: string; input: CreateEditRequestInput; actor: EditRequestActor },
): Promise<{ id: string; itemIds: string[] }> {
  const { input } = args;
  // 最新の版を確かめてから項目を入れるまでのあいだに、版が進まないようにする
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  if (page.headVersionId !== input.baseVersionId) {
    throw new HttpError(409, "version_conflict", "baseVersionId is not the latest version; read the page again and make the request from it", {
      headVersionId: page.headVersionId,
    });
  }
  const [head] = await tx.select({ bodyMd: pageVersions.bodyMd }).from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  const lineCount = bodyLines(head!.bodyMd).length;
  const originals = input.items.map((item, index) => {
    const original = sliceLines(head!.bodyMd, item.startLine, item.endLine);
    if (original === null) {
      throw new HttpError(400, "line_out_of_range", `items[${index}]: lines ${item.startLine}-${item.endLine} are outside the body (${lineCount} lines)`, {
        index,
        lineCount,
      });
    }
    if (item.kind !== "note" && replacementLines(item.replacement).join("\n") === original && item.replacement !== "") {
      throw new HttpError(400, "no_change", `items[${index}]: the replacement is the same as the current text`, { index });
    }
    return original;
  });

  const [request] = await tx
    .insert(editRequests)
    .values({
      wikiId: args.wikiId,
      pageId: page.id,
      comment: input.comment || null,
      createdBy: args.actor.userId,
      oauthGrantId: args.actor.oauthGrantId ?? null,
    })
    .returning({ id: editRequests.id });
  const items = await tx
    .insert(editRequestItems)
    .values(
      input.items.map((item, position) => ({
        requestId: request!.id,
        position,
        baseVersionId: page.headVersionId,
        startLine: item.startLine,
        endLine: item.endLine,
        originalMd: originals[position]!,
        // 指摘は置き換え案を持たず、本文を持つ（DB の制約 `edit_request_items_kind_shape_check` と同じ形）
        ...(item.kind === "note"
          ? { kind: "note" as const, replacementMd: null, reason: null, noteBody: item.body }
          : { kind: "suggestion" as const, replacementMd: item.replacement, reason: item.reason || null, noteBody: null }),
      })),
    )
    .returning({ id: editRequestItems.id, position: editRequestItems.position });
  return { id: request!.id, itemIds: items.sort((a, b) => a.position - b.position).map((i) => i.id) };
}

// ---------------------------------------------------------------------------
// 読む
// ---------------------------------------------------------------------------

const toLineEdit = (item: ItemRow, headVersionId: string): LineEdit => ({
  id: item.id,
  startLine: item.startLine,
  endLine: item.endLine,
  originalText: item.originalMd,
  replacement: item.replacementMd ?? "",
  atBase: item.baseVersionId === headVersionId,
});

/**
 * そのページのリクエストと項目（新しい順、`EDIT_REQUEST_LIST_LIMIT` 件まで）。
 * 未対応・却下・解決済みの項目には、最新の版での行の範囲（`current`）を付ける。未対応の項目の箇所が書き換えられていたら `stale` に理由が入る
 * （提案は採用できない。指摘は、そのまま解決済みにできる）。項目ごとの返信（古い順）も付ける。
 *
 * `only` で絞れる：`requestId` は1件だけ、`oauthGrantId` はその連携が出したものだけ（MCP で、非公開のページを読めないアプリ向け）。
 */
export async function listEditRequests(
  db: Db,
  page: PageRow,
  only: { requestId?: string; oauthGrantId?: string } = {},
): Promise<PageEditRequests> {
  const [head] = await db.select({ bodyMd: pageVersions.bodyMd }).from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  const requests = await db
    .select({ request: editRequests, creatorName: personName, via: oauthClients.name })
    .from(editRequests)
    .innerJoin(users, eq(users.id, editRequests.createdBy))
    .leftJoin(oauthGrants, eq(oauthGrants.id, editRequests.oauthGrantId))
    .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(
      and(
        eq(editRequests.pageId, page.id),
        only.requestId ? eq(editRequests.id, only.requestId) : undefined,
        only.oauthGrantId ? eq(editRequests.oauthGrantId, only.oauthGrantId) : undefined,
      ),
    )
    .orderBy(desc(editRequests.createdAt), desc(editRequests.id))
    .limit(EDIT_REQUEST_LIST_LIMIT);
  const ids = requests.map((r) => r.request.id);
  const items =
    ids.length === 0
      ? []
      : await db
          .select({ item: editRequestItems, deciderName: personName })
          .from(editRequestItems)
          .leftJoin(users, eq(users.id, editRequestItems.decidedBy))
          .where(inArray(editRequestItems.requestId, ids))
          .orderBy(asc(editRequestItems.position));

  const comments = ids.length === 0 ? new Map<string, EditRequestComment[]>() : await commentsOf(db, inArray(editRequestItems.requestId, ids));

  const byRequest = new Map<string, EditRequestItem[]>();
  let openCount = 0;
  for (const { item, deciderName } of items) {
    const located =
      item.status === "open" || item.status === "rejected" || item.status === "resolved" ? locateLineEdit(head!.bodyMd, toLineEdit(item, page.headVersionId)) : null;
    // 未対応の数え方は `countOpenItems` と同じ（種類を問わず open）
    if (item.status === "open") openCount++;
    const list = byRequest.get(item.requestId) ?? [];
    list.push({
      id: item.id,
      requestId: item.requestId,
      kind: item.kind,
      status: item.status,
      baseVersionId: item.baseVersionId,
      startLine: item.startLine,
      endLine: item.endLine,
      originalText: item.originalMd,
      replacement: item.replacementMd,
      reason: item.reason,
      body: item.noteBody,
      decidedBy: item.decidedBy && deciderName ? { id: item.decidedBy, name: deciderName } : null,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      acceptedVersionId: item.acceptedVersionId,
      current: located?.ok ? { startLine: located.startLine, endLine: located.endLine } : null,
      stale: item.status === "open" && located && !located.ok ? located.reason : null,
      comments: comments.get(item.id) ?? [],
    });
    byRequest.set(item.requestId, list);
  }
  return {
    headVersionId: page.headVersionId,
    headBodyMd: head!.bodyMd,
    openCount,
    requests: requests.map(
      ({ request, creatorName, via }): EditRequest => ({
        id: request.id,
        pageId: request.pageId,
        comment: request.comment,
        createdBy: { id: request.createdBy, name: creatorName },
        via: via ?? null,
        createdAt: request.createdAt.toISOString(),
        items: byRequest.get(request.id) ?? [],
      }),
    ),
  };
}

/** 返信を、項目ごとにまとめて読む（古い順）。`where` は、項目（`edit_request_items`）への条件 */
async function commentsOf(db: Db, where: SQL): Promise<Map<string, EditRequestComment[]>> {
  const rows = await db
    .select({ comment: editRequestComments, authorName: personName, via: oauthClients.name })
    .from(editRequestComments)
    .innerJoin(editRequestItems, eq(editRequestItems.id, editRequestComments.itemId))
    .innerJoin(users, eq(users.id, editRequestComments.createdBy))
    .leftJoin(oauthGrants, eq(oauthGrants.id, editRequestComments.oauthGrantId))
    .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(where)
    .orderBy(asc(editRequestComments.createdAt), asc(editRequestComments.id));
  const byItem = new Map<string, EditRequestComment[]>();
  for (const { comment, authorName, via } of rows) {
    const list = byItem.get(comment.itemId) ?? [];
    list.push({
      id: comment.id,
      itemId: comment.itemId,
      body: comment.body,
      createdBy: { id: comment.createdBy, name: authorName },
      via: via ?? null,
      createdAt: comment.createdAt.toISOString(),
    });
    byItem.set(comment.itemId, list);
  }
  return byItem;
}

/**
 * そのページの、未対応の項目の数（古くなったものも含む）。**未対応の数え方は、ここ（と `listEditRequests` の `openCount`）で決めている**：
 * 種類を問わず `status = 'open'`。提案は採用・却下、指摘は解決済みにすると、どちらも取り下げると、数から外れる。
 * 未対応だけの索引（`edit_request_items_open_idx`）が、この条件に合わせてある。
 */
export async function countOpenItems(db: Db, pageId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(editRequestItems)
    .innerJoin(editRequests, eq(editRequests.id, editRequestItems.requestId))
    .where(and(eq(editRequests.pageId, pageId), eq(editRequestItems.status, "open")));
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// wiki ごとの一覧と、サイドバーの件数
// ---------------------------------------------------------------------------

/** そのリクエストに、未対応の項目があるか（未対応だけの索引 `edit_request_items_open_idx` を1回引く）。数え方は `countOpenItems` と同じ */
const hasOpenItem = exists(
  sql`(select 1 from ${editRequestItems} where ${editRequestItems.requestId} = ${editRequests.id} and ${editRequestItems.status} = 'open')`,
);
/** ゴミ箱に入っていないページ */
const livePage = isNull(pages.deletedAt);

/**
 * その wiki のリクエストの一覧（`status` で絞る。open: 未対応の項目がある、done: 未対応の項目が0件）。ゴミ箱のページのものは出さない。
 *
 * **並びは、出した日時（`created_at`）の新しい順**。日時が同じなら id の順。続きは「最後の行より後ろ」で取る（`GET /pages` と同じ形のカーソル）。
 * 出した日時は変わらないので、続きを取っているあいだに採否や返信があっても、行の順番は動かない（抜けも重なりも出ない）。
 * 「最後の動き」は並びに使わず、返す行にだけ付ける（複数のテーブルにまたがり、動きのたびに変わるため）。
 *
 * 項目の数・未対応の数・最後の動きは、返す行（`limit` 件まで）についてだけ数える。
 */
export async function listWikiEditRequests(
  db: Db,
  wikiId: string,
  opts: { status: EditRequestListStatus; limit: number; after: ListCursor | null },
): Promise<EditRequestList> {
  const { limit, after } = opts;
  const rest = after ? sql`(${editRequests.createdAt}, ${editRequests.id}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined;
  const rows = await db
    .select({
      request: editRequests,
      // 日時はマイクロ秒まで持っている。カーソルには文字のまま使う（ページの一覧と同じ）
      createdAtText: sql<string>`${editRequests.createdAt}::text`,
      creatorName: personName,
      via: oauthClients.name,
      pageTitle: pages.title,
      pageIcon: pages.icon,
    })
    .from(editRequests)
    .innerJoin(pages, eq(pages.id, editRequests.pageId))
    .innerJoin(users, eq(users.id, editRequests.createdBy))
    .leftJoin(oauthGrants, eq(oauthGrants.id, editRequests.oauthGrantId))
    .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(and(eq(editRequests.wikiId, wikiId), livePage, opts.status === "open" ? hasOpenItem : not(hasOpenItem), rest))
    .orderBy(desc(editRequests.createdAt), desc(editRequests.id))
    // 1件多く取って、続きがあるかを見る
    .limit(limit + 1);
  const shown = rows.slice(0, limit);
  const ids = shown.map((r) => r.request.id);

  const itemStats =
    ids.length === 0
      ? []
      : await db
          .select({
            requestId: editRequestItems.requestId,
            items: sql<number>`count(*)::int`,
            open: sql<number>`count(*) filter (where ${editRequestItems.status} = 'open')::int`,
            // 未対応に戻した項目は、決めた日時が消える（戻したこと自体は、動きに数えない）
            decidedAt: sql<Date | string | null>`max(${editRequestItems.decidedAt})`,
          })
          .from(editRequestItems)
          .where(inArray(editRequestItems.requestId, ids))
          .groupBy(editRequestItems.requestId);
  const replyStats =
    ids.length === 0
      ? []
      : await db
          .select({ requestId: editRequestItems.requestId, repliedAt: sql<Date | string | null>`max(${editRequestComments.createdAt})` })
          .from(editRequestComments)
          .innerJoin(editRequestItems, eq(editRequestItems.id, editRequestComments.itemId))
          .where(inArray(editRequestItems.requestId, ids))
          .groupBy(editRequestItems.requestId);
  const statsOf = new Map(itemStats.map((s) => [s.requestId, s]));
  const repliedAtOf = new Map(replyStats.map((s) => [s.requestId, s.repliedAt]));
  const time = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : 0);

  const last = shown[shown.length - 1];
  return {
    requests: shown.map(({ request, creatorName, via, pageTitle, pageIcon }): EditRequestListItem => {
      const stats = statsOf.get(request.id);
      return {
        id: request.id,
        pageId: request.pageId,
        pageTitle,
        pageIcon,
        comment: request.comment,
        createdBy: { id: request.createdBy, name: creatorName },
        via: via ?? null,
        createdAt: request.createdAt.toISOString(),
        itemCount: Number(stats?.items ?? 0),
        openCount: Number(stats?.open ?? 0),
        lastActivityAt: new Date(Math.max(request.createdAt.getTime(), time(stats?.decidedAt), time(repliedAtOf.get(request.id)))).toISOString(),
      };
    }),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.createdAtText, id: last.request.id }) : null,
  };
}

/**
 * その wiki で、未対応の項目があるページの数（サイドバーに出す。項目の数でも、リクエストの数でもない）。ゴミ箱のページは数えない。
 * 未対応かどうかは `countOpenItems` と同じ（種類を問わず `status = 'open'`）。
 */
export async function countPagesWithOpenEditRequests(db: Db, wikiId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${editRequests.pageId})::int` })
    .from(editRequests)
    .innerJoin(pages, eq(pages.id, editRequests.pageId))
    .where(and(eq(editRequests.wikiId, wikiId), livePage, hasOpenItem));
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// 採用
// ---------------------------------------------------------------------------

/**
 * 項目を採用する：最新の版の該当行を置き換えて、新しい版を1つ作る（公開はしない）。トランザクション内で呼ぶ。
 *
 * - `itemId` を渡すと、その1件。採用できなければ 409 にする（古くなった：`edit_request_stale`、
 *   編集中の人の下書きで元の文面が見つからない：`draft_conflict`、未対応でない：`not_open`）
 * - `requestId` を渡すと「すべて採用」：そのリクエストの未対応の項目のうち、採用できるものだけを1つの版にまとめ、
 *   できなかった項目を `skipped` に入れて返す（1件も採用できなければ、版は作らない）
 *
 * ページの行を `FOR UPDATE` で取ってから最新の版を読むので、同時に来た採用・保存とは順番に処理される。
 * そのページの下書きのうち、最新の版をもとにしたものには同じ置き換えをかけ、もとにする版を新しい版に付け替える
 * （編集中の人が、次の保存で採用を巻き戻さないように）。
 */
export async function acceptEditRequestItems(
  tx: Db,
  args: { wikiId: string; pageId: string; target: { itemId: string } | { requestId: string }; actor: EditRequestActor },
): Promise<AcceptEditRequestResult> {
  const single = "itemId" in args.target ? args.target.itemId : null;
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const rows = await lockItems(tx, page.id, args.target);
  if (single !== null) {
    if (rows.length === 0) throw notFound("edit request item");
    // 指摘は置き換え案を持たないので、採用できない（解決済みにする）
    if (rows[0]!.kind !== "suggestion") throw notASuggestion();
    if (rows[0]!.status !== "open") throw notOpen(rows[0]!);
  } else if (!(await requestExists(tx, page.id, (args.target as { requestId: string }).requestId))) {
    throw notFound("edit request");
  }
  // 指摘は、採用の対象にならない（「すべて採用」でも、未対応のまま残る）
  const open = rows.filter((r) => r.status === "open" && r.kind === "suggestion" && r.replacementMd !== null);

  const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  const edits = open.map((r) => toLineEdit(r, page.headVersionId));
  const onHead = applyLineEdits(head!.bodyMd, edits);
  const skipped: EditRequestSkipped[] = onHead.skipped.map((s) => ({ itemId: s.id, reason: s.reason }));
  const appliedIds = new Set(onHead.applied.map((a) => a.id));
  const candidates = edits.filter((e) => appliedIds.has(e.id));

  // 最新の版をもとにした下書き。古い版をもとにした下書きは、もともと版にならないので触らない
  const drafts = await tx
    .select({ draft: pageDrafts, editorName: personName })
    .from(pageDrafts)
    .innerJoin(users, eq(users.id, pageDrafts.userId))
    .where(and(eq(pageDrafts.pageId, page.id), eq(pageDrafts.baseVersionId, page.headVersionId)));
  // 下書きの本文は最新の版から変わっているので、元の文面で場所を探す
  const onDraft = (bodyMd: string, list: readonly LineEdit[]) => applyLineEdits(bodyMd, list.map((e) => ({ ...e, atBase: false })));
  const blocked = new Map<string, EditRequestPerson[]>();
  for (const { draft, editorName } of drafts) {
    for (const s of onDraft(draft.bodyMd, candidates).skipped) {
      blocked.set(s.id, [...(blocked.get(s.id) ?? []), { id: draft.userId, name: editorName }]);
    }
  }
  for (const [itemId, editors] of blocked) skipped.push({ itemId, reason: "draft_conflict", editors });

  if (single !== null && skipped.length > 0) {
    const s = skipped[0]!;
    if (s.reason === "draft_conflict") {
      throw new HttpError(409, "draft_conflict", "someone is editing this part of the page; their draft no longer has the original text", {
        editors: s.editors,
      });
    }
    throw new HttpError(409, "edit_request_stale", "this part of the page was rewritten after the request was made", { reason: s.reason });
  }

  const order = new Map(open.map((r, i) => [r.id, i]));
  skipped.sort((a, b) => order.get(a.itemId)! - order.get(b.itemId)!);
  const accepted = candidates.filter((e) => !blocked.has(e.id));
  if (accepted.length === 0) return { headVersionId: page.headVersionId, versionId: null, applied: [], skipped };

  const result = applyLineEdits(head!.bodyMd, accepted);
  // 版は必ず createVersion で作る（head を進める、検索用の写しを合わせる、内部リンクを作り直す）
  const { versionId } = await createVersion(
    tx,
    page,
    { title: head!.title, bodyMd: result.body },
    { keep: true, createdBy: args.actor.userId, oauthGrantId: args.actor.oauthGrantId },
  );
  for (const { draft } of drafts) {
    const bodyMd = onDraft(draft.bodyMd, accepted).body;
    const own = and(eq(pageDrafts.pageId, page.id), eq(pageDrafts.userId, draft.userId));
    // 新しい版と同じ内容になった下書きは、無いのと同じ（下書きの保存と同じ扱い）
    if (draft.title === head!.title && bodyMd === result.body) await tx.delete(pageDrafts).where(own);
    // 自動保存の時刻（updated_at）は進めない（本人が打ったわけではない）
    else await tx.update(pageDrafts).set({ bodyMd, baseVersionId: versionId }).where(own);
  }
  await tx
    .update(editRequestItems)
    .set({ status: "accepted", decidedBy: args.actor.userId, decidedAt: new Date(), acceptedVersionId: versionId })
    .where(
      inArray(
        editRequestItems.id,
        accepted.map((e) => e.id),
      ),
    );
  return {
    headVersionId: versionId,
    versionId,
    applied: result.applied.map((a) => ({ itemId: a.id, startLine: a.startLine, endLine: a.endLine })),
    skipped,
  };
}

const notOpen = (item: ItemRow) =>
  new HttpError(409, "not_open", `this item is already ${item.status}`, { status: item.status });
/** 種類に合わない操作：指摘を採用・却下しようとした */
const notASuggestion = () =>
  new HttpError(409, "not_a_suggestion", "this item is a note without a replacement; it cannot be accepted or rejected, only resolved", { kind: "note" });

/** そのページの項目を、行ロックして読む（リクエストの中の並び順）。別のページ・別の wiki の項目は、無いものとして扱う。 */
async function lockItems(tx: Db, pageId: string, target: { itemId: string } | { requestId: string }): Promise<ItemRow[]> {
  const rows = await tx
    .select({ item: editRequestItems })
    .from(editRequestItems)
    .innerJoin(editRequests, eq(editRequests.id, editRequestItems.requestId))
    .where(
      and(eq(editRequests.pageId, pageId), "itemId" in target ? eq(editRequestItems.id, target.itemId) : eq(editRequestItems.requestId, target.requestId)),
    )
    .orderBy(asc(editRequestItems.position))
    .for("update", { of: editRequestItems });
  return rows.map((r) => r.item);
}

async function requestExists(db: Db, pageId: string, requestId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: editRequests.id })
    .from(editRequests)
    .where(and(eq(editRequests.pageId, pageId), eq(editRequests.id, requestId)));
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// 却下・解決済み・未対応に戻す・取り下げ
// ---------------------------------------------------------------------------

/** 未対応の提案を却下する。古くなった項目も却下できる。指摘は却下できない（409 `not_a_suggestion`）。トランザクション内で呼ぶ。 */
export async function rejectEditRequestItem(tx: Db, args: { wikiId: string; pageId: string; itemId: string; actor: EditRequestActor }): Promise<void> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  if (item.kind !== "suggestion") throw notASuggestion();
  if (item.status !== "open") throw notOpen(item);
  await tx
    .update(editRequestItems)
    .set({ status: "rejected", decidedBy: args.actor.userId, decidedAt: new Date() })
    .where(eq(editRequestItems.id, item.id));
}

/**
 * 未対応の指摘を、解決済みにする。箇所が書き換えられて古くなった指摘も、解決済みにできる（本文は変わらない）。
 * 提案は解決済みにできない（409 `not_a_note`。採用か却下で決める）。トランザクション内で呼ぶ。
 */
export async function resolveEditRequestItem(tx: Db, args: { wikiId: string; pageId: string; itemId: string; actor: EditRequestActor }): Promise<void> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  if (item.kind !== "note") {
    throw new HttpError(409, "not_a_note", "this item is a suggestion; accept or reject it instead of resolving", { kind: item.kind });
  }
  if (item.status !== "open") throw notOpen(item);
  await tx
    .update(editRequestItems)
    .set({ status: "resolved", decidedBy: args.actor.userId, decidedAt: new Date() })
    .where(eq(editRequestItems.id, item.id));
}

/**
 * 却下した提案・解決済みにした指摘を、未対応に戻す。採用・取り下げの項目は戻せない（採用の取り消しは、版履歴から前の版に戻す）。
 * 戻せない状態なら 409：提案は `not_rejected`、指摘は `not_resolved`。トランザクション内で呼ぶ。
 */
export async function reopenEditRequestItem(tx: Db, args: { wikiId: string; pageId: string; itemId: string }): Promise<void> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  if (item.kind === "note") {
    if (item.status !== "resolved") throw new HttpError(409, "not_resolved", `only resolved notes can be reopened; this item is ${item.status}`, { status: item.status });
  } else if (item.status !== "rejected") {
    throw new HttpError(409, "not_rejected", `only rejected items can be reopened; this item is ${item.status}`, { status: item.status });
  }
  await tx.update(editRequestItems).set({ status: "open", decidedBy: null, decidedAt: null }).where(eq(editRequestItems.id, item.id));
}

/**
 * 出した本人が、未対応の項目をまとめて取り下げる。返すのは、取り下げた項目の数。トランザクション内で呼ぶ。
 * 本人でなければ 403（`not_requester`）。`byGrantOnly` を渡すと、その連携が出したリクエストだけ（MCP から）。
 */
export async function withdrawEditRequest(
  tx: Db,
  args: { wikiId: string; pageId: string; requestId: string; actor: EditRequestActor; byGrantOnly?: boolean },
): Promise<{ withdrawn: number }> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [request] = await tx
    .select()
    .from(editRequests)
    .where(and(eq(editRequests.pageId, page.id), eq(editRequests.id, args.requestId)));
  if (!request) throw notFound("edit request");
  if (request.createdBy !== args.actor.userId || (args.byGrantOnly && request.oauthGrantId !== args.actor.oauthGrantId)) {
    throw new HttpError(403, "not_requester", "only the one who made this request can withdraw it");
  }
  const rows = await tx
    .update(editRequestItems)
    .set({ status: "withdrawn", decidedBy: args.actor.userId, decidedAt: new Date() })
    .where(and(eq(editRequestItems.requestId, request.id), eq(editRequestItems.status, "open")))
    .returning({ id: editRequestItems.id });
  return { withdrawn: rows.length };
}

// ---------------------------------------------------------------------------
// 返信
// ---------------------------------------------------------------------------

/**
 * 項目に返信する。項目の状態は問わない（採用・却下・解決済み・取り下げのあとも書ける）。本文はプレーンテキスト。
 * 1つの項目に付けられるのは `EDIT_REQUEST_LIMITS.repliesPerItem` 件まで（超えると 409 `too_many_replies`）。トランザクション内で呼ぶ。
 * ゴミ箱のページ・別の wiki のページの項目は、無いものとして扱う（`findLivePage`）。
 */
export async function addEditRequestComment(
  tx: Db,
  args: { wikiId: string; pageId: string; itemId: string; body: string; actor: EditRequestActor },
): Promise<EditRequestComment> {
  const page = await findLivePage(tx, args.wikiId, args.pageId);
  // 項目の行を取ってから数えるので、同時に来た返信とは順番に処理される
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  const [counted] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(editRequestComments)
    .where(eq(editRequestComments.itemId, item.id));
  if (Number(counted?.count ?? 0) >= EDIT_REQUEST_LIMITS.repliesPerItem) {
    throw new HttpError(409, "too_many_replies", `an item can have up to ${EDIT_REQUEST_LIMITS.repliesPerItem} replies`, { limit: EDIT_REQUEST_LIMITS.repliesPerItem });
  }
  const [made] = await tx
    .insert(editRequestComments)
    .values({ itemId: item.id, body: args.body, createdBy: args.actor.userId, oauthGrantId: args.actor.oauthGrantId ?? null })
    .returning({ id: editRequestComments.id });
  const list = (await commentsOf(tx, eq(editRequestItems.id, item.id))).get(item.id) ?? [];
  return list.find((c) => c.id === made!.id)!;
}

// ---------------------------------------------------------------------------
// 編集画面が、開いたままの手元の内容に取り込む
// ---------------------------------------------------------------------------

/**
 * `since` の版から最新の版までのあいだに、採用でかかった置き換え（古い順）。
 * あいだの版が、採用でできた版か、`userId` の下書きから自動でできた版（中身は、その人の続き）だけなら `mergeable`。
 * だれかがふつうに保存した版が挟まっていたら、取り込めない（`mergeable: false`）。
 */
export async function appliedEditRequestsSince(db: Db, page: PageRow, since: string, userId: string): Promise<AppliedEditRequests> {
  const decider = alias(users, "decider");
  const steps: AppliedEditRequests["steps"] = [];
  const unmergeable: AppliedEditRequests = { headVersionId: page.headVersionId, mergeable: false, steps: [] };
  let cursor: string | null = page.headVersionId;
  for (let i = 0; i < APPLIED_WALK_LIMIT && cursor !== null; i++) {
    if (cursor === since) return { headVersionId: page.headVersionId, mergeable: true, steps: steps.reverse() };
    const [version] = await db
      .select({ baseVersionId: pageVersions.baseVersionId, keep: pageVersions.keep, createdBy: pageVersions.createdBy })
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, page.id), eq(pageVersions.id, cursor)));
    if (!version) return unmergeable;
    const items = await db
      .select({
        id: editRequestItems.id,
        originalMd: editRequestItems.originalMd,
        replacementMd: editRequestItems.replacementMd,
        decidedBy: editRequestItems.decidedBy,
        deciderName: sql<string | null>`coalesce(${decider.name}, ${decider.email})`,
      })
      .from(editRequestItems)
      .leftJoin(decider, eq(decider.id, editRequestItems.decidedBy))
      .where(and(eq(editRequestItems.acceptedVersionId, cursor), eq(editRequestItems.status, "accepted")))
      .orderBy(asc(editRequestItems.requestId), asc(editRequestItems.position));
    if (items.length > 0) {
      const by = items[0]!;
      steps.push({
        versionId: cursor,
        acceptedBy: by.decidedBy && by.deciderName ? { id: by.decidedBy, name: by.deciderName } : null,
        edits: items.map((i) => ({ itemId: i.id, originalText: i.originalMd, replacement: i.replacementMd ?? "" })),
      });
    } else if (version.keep || version.createdBy !== userId) {
      return unmergeable;
    }
    cursor = version.baseVersionId;
  }
  return unmergeable;
}
