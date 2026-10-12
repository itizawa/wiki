import {
  createEditRequestInput,
  editRequestCommentInput,
  isEditRequestListStatus,
  type AcceptEditRequestResult,
  type AppliedEditRequests,
  type CreatedEditRequest,
  type EditRequestComment,
  type EditRequestCount,
  type EditRequestList,
  type EditRequestPageCount,
  type PageEditRequests,
} from "@wiki/shared";
import { Hono, type Context } from "hono";
import {
  acceptEditRequestItems,
  addEditRequestComment,
  appliedEditRequestsSince,
  countOpenItems,
  countPagesWithOpenEditRequests,
  createEditRequest,
  listEditRequests,
  listWikiEditRequests,
  rejectEditRequestItem,
  reopenEditRequestItem,
  resolveEditRequestItem,
  withdrawEditRequest,
} from "../editRequests/service";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import { parseJson } from "../validation";
import { clampPageLimit, decodeCursor, findLivePage } from "./pages";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 経路の ID が UUID の形でなければ、無いものとして扱う（DB に渡してから失敗させない）。 */
function uuidParam(c: Context<AppEnv>, name: string, what: string): string {
  const value = c.req.param(name) ?? "";
  if (!UUID_PATTERN.test(value)) throw notFound(what);
  return value;
}

/**
 * `/admin/w/{key}/pages/:id/...`：ページの編集リクエスト（出す・読む・採用・却下・解決済み・未対応に戻す・取り下げ・返信）。
 * wiki のメンバーならだれでも使える（`requireUser` + `requireAccess` + `resolveWiki`）。ページがその wiki のもので、
 * ゴミ箱に入っていないことは、どの経路も `findLivePage` で確かめる（別の wiki のページは 404）。
 */
export const editRequestRoutes = new Hono<AppEnv>()
  // 人が管理画面から出す。検査と上限は、MCP の `create_edit_request` と同じ（入力のスキーマと `createEditRequest`）。
  // 基準の版が最新の版でなければ 409（`version_conflict`）。画面は、読み直してから出し直す
  .post("/:id/edit-requests", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, createEditRequestInput);
    const made = await db.transaction((tx) =>
      createEditRequest(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), input, actor: { userId: c.get("user").id } }),
    );
    return c.json(made satisfies CreatedEditRequest, 201);
  })
  .get("/:id/edit-requests", async (c) => {
    const { db } = c.get("deps");
    const page = await findLivePage(db, c.get("wiki").id, c.req.param("id"));
    return c.json((await listEditRequests(db, page)) satisfies PageEditRequests);
  })
  // 編集画面の入口に出す、未対応の件数
  .get("/:id/edit-requests/count", async (c) => {
    const { db } = c.get("deps");
    const page = await findLivePage(db, c.get("wiki").id, c.req.param("id"));
    return c.json({ open: await countOpenItems(db, page.id) } satisfies EditRequestCount);
  })
  // ?since={版のID}：その版のあとに採用でかかった置き換え。編集画面が、開いたままの手元の内容に取り込むのに使う
  .get("/:id/edit-requests/applied", async (c) => {
    const { db } = c.get("deps");
    const since = c.req.query("since") ?? "";
    if (!UUID_PATTERN.test(since)) throw notFound("version");
    const page = await findLivePage(db, c.get("wiki").id, c.req.param("id"));
    return c.json((await appliedEditRequestsSince(db, page, since, c.get("user").id)) satisfies AppliedEditRequests);
  })
  .post("/:id/edit-request-items/:itemId/accept", async (c) => {
    const { db } = c.get("deps");
    const itemId = uuidParam(c, "itemId", "edit request item");
    const result = await db.transaction((tx) =>
      acceptEditRequestItems(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), target: { itemId }, actor: { userId: c.get("user").id } }),
    );
    return c.json(result satisfies AcceptEditRequestResult);
  })
  .post("/:id/edit-request-items/:itemId/reject", async (c) => {
    const { db } = c.get("deps");
    const itemId = uuidParam(c, "itemId", "edit request item");
    await db.transaction((tx) =>
      rejectEditRequestItem(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), itemId, actor: { userId: c.get("user").id } }),
    );
    return c.json({ ok: true });
  })
  // 指摘を解決済みにする（提案は 409 `not_a_note`）。古くなった指摘も解決済みにできる
  .post("/:id/edit-request-items/:itemId/resolve", async (c) => {
    const { db } = c.get("deps");
    const itemId = uuidParam(c, "itemId", "edit request item");
    await db.transaction((tx) =>
      resolveEditRequestItem(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), itemId, actor: { userId: c.get("user").id } }),
    );
    return c.json({ ok: true });
  })
  // 項目に返信する。項目の状態は問わない。本文はプレーンテキスト
  .post("/:id/edit-request-items/:itemId/comments", async (c) => {
    const { db } = c.get("deps");
    const itemId = uuidParam(c, "itemId", "edit request item");
    const input = await parseJson(c, editRequestCommentInput);
    const made = await db.transaction((tx) =>
      addEditRequestComment(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), itemId, body: input.body, actor: { userId: c.get("user").id } }),
    );
    return c.json(made satisfies EditRequestComment, 201);
  })
  // 却下した提案・解決済みにした指摘を、未対応に戻す
  .post("/:id/edit-request-items/:itemId/reopen", async (c) => {
    const { db } = c.get("deps");
    const itemId = uuidParam(c, "itemId", "edit request item");
    await db.transaction((tx) => reopenEditRequestItem(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), itemId }));
    return c.json({ ok: true });
  })
  // 「すべて採用」：採用できる項目だけを1つの版にまとめ、できなかった項目を返す
  .post("/:id/edit-requests/:requestId/accept-all", async (c) => {
    const { db } = c.get("deps");
    const requestId = uuidParam(c, "requestId", "edit request");
    const result = await db.transaction((tx) =>
      acceptEditRequestItems(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), target: { requestId }, actor: { userId: c.get("user").id } }),
    );
    return c.json(result satisfies AcceptEditRequestResult);
  })
  // 出した本人だけ。未対応の項目をまとめて取り下げる
  .post("/:id/edit-requests/:requestId/withdraw", async (c) => {
    const { db } = c.get("deps");
    const requestId = uuidParam(c, "requestId", "edit request");
    const result = await db.transaction((tx) =>
      withdrawEditRequest(tx, { wikiId: c.get("wiki").id, pageId: c.req.param("id"), requestId, actor: { userId: c.get("user").id } }),
    );
    return c.json(result);
  });

/**
 * `/admin/w/{key}/edit-requests`：その wiki のリクエストの一覧と、サイドバーに出す件数。wiki のメンバーならだれでも使える。
 * ゴミ箱のページのものは出さない・数えない。アーカイブ中の wiki は、手前の `resolveWiki` が 404 にする。
 * ページごとの経路（上の `editRequestRoutes`）とは別に掛ける（`/pages/edit-requests` は、ページの ID として読まれてしまう）。
 */
export const wikiEditRequestRoutes = new Hono<AppEnv>()
  // ?status=open|done（省くと open）&limit=&cursor=：出した日時の新しい順。`nextCursor` を次の呼び出しに渡す（`GET /pages` と同じ形）
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const status = c.req.query("status") ?? "open";
    if (!isEditRequestListStatus(status)) throw new HttpError(400, "invalid_status", "status must be open or done");
    const cursorParam = c.req.query("cursor");
    const list = await listWikiEditRequests(db, c.get("wiki").id, {
      status,
      limit: clampPageLimit(c.req.query("limit")),
      after: cursorParam === undefined ? null : decodeCursor(cursorParam, UUID_PATTERN),
    });
    return c.json(list satisfies EditRequestList);
  })
  // 未対応の項目があるページの数。サイドバーが出ているあいだ、くり返し呼ばれる
  .get("/count", async (c) => {
    const { db } = c.get("deps");
    return c.json({ pages: await countPagesWithOpenEditRequests(db, c.get("wiki").id) } satisfies EditRequestPageCount);
  });
