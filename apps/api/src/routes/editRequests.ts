import type { AcceptEditRequestResult, AppliedEditRequests, EditRequestCount, PageEditRequests } from "@wiki/shared";
import { Hono, type Context } from "hono";
import {
  acceptEditRequestItems,
  appliedEditRequestsSince,
  countOpenItems,
  listEditRequests,
  rejectEditRequestItem,
  reopenEditRequestItem,
  withdrawEditRequest,
} from "../editRequests/service";
import type { AppEnv } from "../env";
import { notFound } from "../errors";
import { findLivePage } from "./pages";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 経路の ID が UUID の形でなければ、無いものとして扱う（DB に渡してから失敗させない）。 */
function uuidParam(c: Context<AppEnv>, name: string, what: string): string {
  const value = c.req.param(name) ?? "";
  if (!UUID_PATTERN.test(value)) throw notFound(what);
  return value;
}

/**
 * `/admin/w/{key}/pages/:id/...`：ページの編集リクエスト（読む・採用・却下・未対応に戻す・取り下げ）。
 * wiki のメンバーならだれでも使える（`requireUser` + `requireAccess` + `resolveWiki`）。ページがその wiki のもので、
 * ゴミ箱に入っていないことは、どの経路も `findLivePage` で確かめる（別の wiki のページは 404）。
 * 出す経路（`POST /:id/edit-requests`）は、まだ無い。出すのは MCP の `create_edit_request` だけ。
 */
export const editRequestRoutes = new Hono<AppEnv>()
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
