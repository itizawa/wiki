import type { PageTag, PageTagList, WikiTag } from "@wiki/shared";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { pages, pageTags, wikiTags } from "../db/schema";
import { writeAudit, type AuditActor } from "../audit/service";
import { HttpError, notFound } from "../errors";

/**
 * 管理用タグの操作。変えるものは、呼ぶ側のトランザクション（tx）の中で呼ぶ。
 * 付け外しは、同じトランザクションに続きの処理（付けた瞬間のイベントなど）を足せるよう、ここにまとめる。
 */

const duplicate = (name: string) => new HttpError(409, "tag_exists", `tag ${name} already exists`);

/** 一意制約の違反か（同時に同じ名前を作ったとき、事前の確認をすり抜けるぶん） */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

async function findTag(tx: Db, wikiId: string, tagId: string) {
  const [tag] = await tx
    .select()
    .from(wikiTags)
    .where(and(eq(wikiTags.wikiId, wikiId), eq(wikiTags.id, tagId)));
  if (!tag) throw notFound(`tag ${tagId}`);
  return tag;
}

/** その wiki のタグ（名前順）。各タグに付いているページの数つき（ゴミ箱のページは数えない） */
export async function listTags(db: Db, wikiId: string): Promise<WikiTag[]> {
  const rows = await db
    .select({ tag: wikiTags, pageCount: count(pages.id) })
    .from(wikiTags)
    .leftJoin(pageTags, eq(pageTags.tagId, wikiTags.id))
    .leftJoin(pages, and(eq(pages.id, pageTags.pageId), isNull(pages.deletedAt)))
    .where(eq(wikiTags.wikiId, wikiId))
    .groupBy(wikiTags.id)
    .orderBy(asc(wikiTags.name), asc(wikiTags.id));
  return rows.map((r) => ({ id: r.tag.id, name: r.tag.name, pageCount: Number(r.pageCount), createdAt: r.tag.createdAt.toISOString() }));
}

/** ページごとのタグ（名前順）。タグが無いページも空の配列で入れる */
export async function tagsForPages(db: Db, pageIds: string[]): Promise<Map<string, PageTag[]>> {
  const byPage = new Map<string, PageTag[]>(pageIds.map((id) => [id, []]));
  if (pageIds.length === 0) return byPage;
  const rows = await db
    .select({ pageId: pageTags.pageId, id: wikiTags.id, name: wikiTags.name })
    .from(pageTags)
    .innerJoin(wikiTags, eq(wikiTags.id, pageTags.tagId))
    .where(inArray(pageTags.pageId, pageIds))
    .orderBy(asc(wikiTags.name), asc(wikiTags.id));
  for (const r of rows) byPage.get(r.pageId)?.push({ id: r.id, name: r.name });
  return byPage;
}

export async function pageTagList(db: Db, pageId: string): Promise<PageTagList> {
  return { tags: (await tagsForPages(db, [pageId])).get(pageId) ?? [] };
}

export async function createTag(tx: Db, wikiId: string, name: string, actor: AuditActor): Promise<WikiTag> {
  const [clash] = await tx.select({ id: wikiTags.id }).from(wikiTags).where(and(eq(wikiTags.wikiId, wikiId), eq(wikiTags.name, name)));
  if (clash) throw duplicate(name);
  const [tag] = await tx
    .insert(wikiTags)
    .values({ wikiId, name })
    .returning()
    .catch((err) => {
      throw isUniqueViolation(err) ? duplicate(name) : err;
    });
  await writeAudit(tx, { wikiId, actor, action: "tag_create", target: { type: "tag", id: tag!.id, label: name }, detail: {} });
  return { id: tag!.id, name, pageCount: 0, createdAt: tag!.createdAt.toISOString() };
}

/** 名前を変える。いまと同じ名前なら何もしない（記録も残さない） */
export async function renameTag(tx: Db, wikiId: string, tagId: string, name: string, actor: AuditActor): Promise<void> {
  const tag = await findTag(tx, wikiId, tagId);
  if (tag.name === name) return;
  const [clash] = await tx
    .select({ id: wikiTags.id })
    .from(wikiTags)
    .where(and(eq(wikiTags.wikiId, wikiId), eq(wikiTags.name, name), ne(wikiTags.id, tagId)));
  if (clash) throw duplicate(name);
  await tx
    .update(wikiTags)
    .set({ name })
    .where(eq(wikiTags.id, tagId))
    .catch((err) => {
      throw isUniqueViolation(err) ? duplicate(name) : err;
    });
  await writeAudit(tx, { wikiId, actor, action: "tag_rename", target: { type: "tag", id: tagId, label: name }, detail: { from: tag.name, to: name } });
}

/** タグを消す。付いていたページからも外れる（ゴミ箱のページのぶんも） */
export async function deleteTag(tx: Db, wikiId: string, tagId: string, actor: AuditActor): Promise<void> {
  const tag = await findTag(tx, wikiId, tagId);
  const removed = await tx.delete(pageTags).where(eq(pageTags.tagId, tagId)).returning({ pageId: pageTags.pageId });
  await tx.delete(wikiTags).where(eq(wikiTags.id, tagId));
  await writeAudit(tx, { wikiId, actor, action: "tag_delete", target: { type: "tag", id: tagId, label: tag.name }, detail: { pages: removed.length } });
}

/** 付ける・外すの対象。この wiki の、ゴミ箱に入っていないページと、この wiki のタグ（どちらかが無ければ 404） */
async function findPair(tx: Db, wikiId: string, pageId: string, tagId: string) {
  const [page] = await tx
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(and(eq(pages.wikiId, wikiId), eq(pages.id, pageId), isNull(pages.deletedAt)));
  if (!page) throw notFound(`page ${pageId}`);
  return { page, tag: await findTag(tx, wikiId, tagId) };
}

/**
 * ページにタグを付ける。すでに付いていれば何もしない。
 * 実際に付けたときだけ true を返し、監査ログを書く。続きの処理（付けた瞬間のイベントなど）は、true のときにだけ、同じ tx で足す。
 */
export async function attachTag(tx: Db, wikiId: string, pageId: string, tagId: string, actor: AuditActor): Promise<boolean> {
  const { page, tag } = await findPair(tx, wikiId, pageId, tagId);
  const added = await tx.insert(pageTags).values({ pageId, tagId }).onConflictDoNothing().returning({ pageId: pageTags.pageId });
  if (added.length === 0) return false;
  await writeAudit(tx, {
    wikiId,
    actor,
    action: "page_tag_add",
    target: { type: "page", id: page.id, label: page.title },
    detail: { tagId, tagName: tag.name },
  });
  return true;
}

/** ページからタグを外す。付いていなければ何もしない。実際に外したときだけ true を返し、監査ログを書く */
export async function detachTag(tx: Db, wikiId: string, pageId: string, tagId: string, actor: AuditActor): Promise<boolean> {
  const { page, tag } = await findPair(tx, wikiId, pageId, tagId);
  const removed = await tx
    .delete(pageTags)
    .where(and(eq(pageTags.pageId, pageId), eq(pageTags.tagId, tagId)))
    .returning({ pageId: pageTags.pageId });
  if (removed.length === 0) return false;
  await writeAudit(tx, {
    wikiId,
    actor,
    action: "page_tag_remove",
    target: { type: "page", id: page.id, label: page.title },
    detail: { tagId, tagName: tag.name },
  });
  return true;
}
