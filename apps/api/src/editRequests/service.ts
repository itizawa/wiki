import {
  applyLineEdits,
  bodyLines,
  locateLineEdit,
  replacementLines,
  sliceLines,
  type AcceptEditRequestResult,
  type AppliedEditRequests,
  type CreateEditRequestInput,
  type EditRequest,
  type EditRequestItem,
  type EditRequestPerson,
  type EditRequestSkipped,
  type LineEdit,
  type PageEditRequests,
} from "@wiki/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { editRequestItems, editRequests, oauthClients, oauthGrants, pageDrafts, pages, pageVersions, users } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { createVersion } from "../pages/versions";
import { findLivePage } from "../routes/pages";

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
 * - 置き換え案が元の文面と同じなら 400（`no_change`）
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
    if (replacementLines(item.replacement).join("\n") === original && item.replacement !== "") {
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
        replacementMd: item.replacement,
        reason: item.reason || null,
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
 * 未対応と却下の項目には、最新の版での行の範囲（`current`）を付ける。未対応の項目が、もう採用できないなら `stale` に理由が入る。
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

  const byRequest = new Map<string, EditRequestItem[]>();
  let openCount = 0;
  for (const { item, deciderName } of items) {
    const located = item.status === "open" || item.status === "rejected" ? locateLineEdit(head!.bodyMd, toLineEdit(item, page.headVersionId)) : null;
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
      replacement: item.replacementMd ?? "",
      reason: item.reason,
      decidedBy: item.decidedBy && deciderName ? { id: item.decidedBy, name: deciderName } : null,
      decidedAt: item.decidedAt?.toISOString() ?? null,
      acceptedVersionId: item.acceptedVersionId,
      current: located?.ok ? { startLine: located.startLine, endLine: located.endLine } : null,
      stale: item.status === "open" && located && !located.ok ? located.reason : null,
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

/** そのページの、未対応の項目の数（古くなったものも含む）。 */
export async function countOpenItems(db: Db, pageId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(editRequestItems)
    .innerJoin(editRequests, eq(editRequests.id, editRequestItems.requestId))
    .where(and(eq(editRequests.pageId, pageId), eq(editRequestItems.status, "open")));
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
    if (rows[0]!.status !== "open") throw notOpen(rows[0]!);
  } else if (!(await requestExists(tx, page.id, (args.target as { requestId: string }).requestId))) {
    throw notFound("edit request");
  }
  // 置き換え案を持たない項目は、採用の対象にならない
  const open = rows.filter((r) => r.status === "open" && r.kind === "suggestion" && r.replacementMd !== null);
  if (single !== null && open.length === 0) throw new HttpError(409, "not_acceptable", "this item has no replacement to accept");

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
// 却下・未対応に戻す・取り下げ
// ---------------------------------------------------------------------------

/** 未対応の項目を却下する。古くなった項目も却下できる。トランザクション内で呼ぶ。 */
export async function rejectEditRequestItem(tx: Db, args: { wikiId: string; pageId: string; itemId: string; actor: EditRequestActor }): Promise<void> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  if (item.status !== "open") throw notOpen(item);
  await tx
    .update(editRequestItems)
    .set({ status: "rejected", decidedBy: args.actor.userId, decidedAt: new Date() })
    .where(eq(editRequestItems.id, item.id));
}

/** 却下した項目を、未対応に戻す。採用・取り下げの項目は戻せない（採用の取り消しは、版履歴から前の版に戻す）。トランザクション内で呼ぶ。 */
export async function reopenEditRequestItem(tx: Db, args: { wikiId: string; pageId: string; itemId: string }): Promise<void> {
  const page = await findLivePage(tx, args.wikiId, args.pageId, true);
  const [item] = await lockItems(tx, page.id, { itemId: args.itemId });
  if (!item) throw notFound("edit request item");
  if (item.status !== "rejected") throw new HttpError(409, "not_rejected", `only rejected items can be reopened; this item is ${item.status}`, { status: item.status });
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
