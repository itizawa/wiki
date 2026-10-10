import { fillTemplate, templateInput, type PageTemplate } from "@wiki/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/client";
import { pageTemplates } from "../db/schema";
import type { AppEnv } from "../env";
import { notFound } from "../errors";
import { parseJson } from "../validation";

type TemplateRow = typeof pageTemplates.$inferSelect;

const toTemplate = (t: TemplateRow): PageTemplate => ({
  id: t.id,
  title: t.title,
  bodyMd: t.bodyMd,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

/** 指定の wiki のテンプレートだけを返す。別の wiki のテンプレートの ID は、無いものとして扱う。 */
export async function findTemplate(db: Db, wikiId: string, id: string): Promise<TemplateRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound(`template ${id}`);
  const [row] = await db
    .select()
    .from(pageTemplates)
    .where(and(eq(pageTemplates.wikiId, wikiId), eq(pageTemplates.id, id)));
  if (!row) throw notFound(`template ${id}`);
  return row;
}

/** 変数を置き換えたタイトルと本文。ページを作るときに使う。 */
export function renderTemplate(t: Pick<TemplateRow, "title" | "bodyMd">, author: string, now = new Date()) {
  const ctx = { now, author };
  return { title: fillTemplate(t.title, ctx).trim() || "無題", bodyMd: fillTemplate(t.bodyMd, ctx) };
}

/** /admin/w/:wikiKey/templates：新しいページのひな形 */
export const templateRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select()
      .from(pageTemplates)
      .where(eq(pageTemplates.wikiId, c.get("wiki").id))
      .orderBy(desc(pageTemplates.updatedAt));
    return c.json({ templates: rows.map(toTemplate) });
  })
  .post("/", async (c) => {
    const { db } = c.get("deps");
    const input = await parseJson(c, templateInput);
    const [row] = await db
      .insert(pageTemplates)
      .values({ wikiId: c.get("wiki").id, title: input.title, bodyMd: input.bodyMd, createdBy: c.get("adminEmail") })
      .returning();
    return c.json(toTemplate(row!), 201);
  })
  .get("/:id", async (c) => {
    const { db } = c.get("deps");
    return c.json(toTemplate(await findTemplate(db, c.get("wiki").id, c.req.param("id"))));
  })
  .put("/:id", async (c) => {
    const { db } = c.get("deps");
    const wikiId = c.get("wiki").id;
    const id = c.req.param("id");
    const input = await parseJson(c, templateInput);
    await findTemplate(db, wikiId, id);
    const [row] = await db
      .update(pageTemplates)
      .set({ title: input.title, bodyMd: input.bodyMd, updatedAt: new Date() })
      .where(eq(pageTemplates.id, id))
      .returning();
    return c.json(toTemplate(row!));
  })
  .delete("/:id", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    await findTemplate(db, c.get("wiki").id, id);
    await db.delete(pageTemplates).where(eq(pageTemplates.id, id));
    return c.json({ ok: true });
  })
  // 変数を置き換えた内容。作ったばかりの空のページに、エディタからテンプレートを当てるときに使う（版を作るのは人）
  .get("/:id/render", async (c) => {
    const { db } = c.get("deps");
    const row = await findTemplate(db, c.get("wiki").id, c.req.param("id"));
    return c.json(renderTemplate(row, c.get("adminEmail")));
  });
