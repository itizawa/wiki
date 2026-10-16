import { createTagInput, renameTagInput } from "@wiki/shared";
import { Hono } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { createTag, deleteTag, detachTag, listTags, pageTagList, renameTag } from "../tags/service";
import { parseJson } from "../validation";
import { attachTagAndEnqueue } from "../workflows/enqueue";
import { runAfterResponse } from "../workflows/run";
import { requireWikiAdmin } from "./wikis";

/** /admin/w/{key}/tags：管理用タグの一覧は wiki のメンバーなら誰でも読める。作る・名前を変える・消すのは管理者だけ */
export const tagRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    return c.json({ tags: await listTags(db, c.get("wiki").id) });
  })
  .post("/", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const { name } = await parseJson(c, createTagInput);
    const tag = await db.transaction((tx) => createTag(tx, c.get("wiki").id, name, auditActor(c)));
    return c.json(tag, 201);
  })
  .patch("/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    const { name } = await parseJson(c, renameTagInput);
    const wikiId = c.get("wiki").id;
    const id = c.req.param("id");
    await db.transaction((tx) => renameTag(tx, wikiId, id, name, auditActor(c)));
    return c.json((await listTags(db, wikiId)).find((t) => t.id === id));
  })
  .delete("/:id", requireWikiAdmin, async (c) => {
    const { db } = c.get("deps");
    await db.transaction((tx) => deleteTag(tx, c.get("wiki").id, c.req.param("id"), auditActor(c)));
    return c.body(null, 204);
  });

/** /admin/w/{key}/pages/{pageId}/tags/{tagId}：ページへの付け外し（編集者以上）。すでにそうなっていれば何も起きず、成功を返す */
export const pageTagRoutes = new Hono<AppEnv>()
  .put("/:pageId/tags/:tagId", async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const pageId = c.req.param("pageId");
    const runIds = await db.transaction((tx) => attachTagAndEnqueue(tx, c.get("wiki").id, pageId, c.req.param("tagId"), auditActor(c)));
    runAfterResponse(db, deps, runIds);
    return c.json(await pageTagList(db, pageId));
  })
  .delete("/:pageId/tags/:tagId", async (c) => {
    const { db } = c.get("deps");
    const pageId = c.req.param("pageId");
    await db.transaction((tx) => detachTag(tx, c.get("wiki").id, pageId, c.req.param("tagId"), auditActor(c)));
    return c.json(await pageTagList(db, pageId));
  });
