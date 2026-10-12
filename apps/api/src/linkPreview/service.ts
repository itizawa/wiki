import type { LinkPreview } from "@wiki/shared";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { linkPreviews } from "../db/schema";
import { fetchHtml, type LinkFetch } from "./fetch";
import { parseOgp } from "./parse";
import { parseFetchableUrl } from "./url";

/** 取れた結果を使い続ける期間。過ぎたら取り直す */
export const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 取れなかった URL を取り直さない期間 */
export const FAILURE_TTL_MS = 60 * 60 * 1000;

type Row = typeof linkPreviews.$inferSelect;

const toPreview = (r: Row): LinkPreview | null =>
  r.ok && r.title ? { title: r.title, description: r.description, imageUrl: r.imageUrl, siteName: r.siteName } : null;

const isFresh = (r: Row, now: Date) => now.getTime() - r.fetchedAt.getTime() < (r.ok ? PREVIEW_TTL_MS : FAILURE_TTL_MS);

/** 取りにいってよい URL か（https・443・ドメイン名。`parseFetchableUrl`）。 */
export const isFetchableUrl = (url: string): boolean => parseFetchableUrl(url) !== null;

/**
 * URL の OGP を返す。キャッシュ（link_previews）が新しければそれを返し、無ければ・古ければ取りにいって保存する。
 * 取れなかった（行き先が許されない・応答が大きすぎる・`text/html` でない・タイトルが無い…）ときは null。例外は投げない。
 * 公開サイトのカードと、あとのホバーのプレビューも、この関数と link_previews の値を使う。
 */
export async function getLinkPreview(db: Db, url: string, options: { fetch?: LinkFetch; now?: Date } = {}): Promise<LinkPreview | null> {
  const target = parseFetchableUrl(url);
  if (!target) return null;
  const now = options.now ?? new Date();
  const key = target.href;
  const [cached] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, key));
  if (cached && isFresh(cached, now)) return toPreview(cached);

  const page = await fetchHtml(target, options.fetch);
  const preview = page ? parseOgp(page.html, page.url) : null;
  const values = {
    ok: preview !== null,
    title: preview?.title ?? null,
    description: preview?.description ?? null,
    imageUrl: preview?.imageUrl ?? null,
    siteName: preview?.siteName ?? null,
    fetchedAt: now,
  };
  await db.insert(linkPreviews).values({ url: key, ...values }).onConflictDoUpdate({ target: linkPreviews.url, set: values });
  return preview;
}

/** 保存してある OGP を読む（取りにいかない）。取れていない URL は含めない。公開ビルド用のマニフェストが使う。 */
export async function savedLinkPreviews(db: Db, urls: readonly string[]): Promise<Map<string, LinkPreview>> {
  const out = new Map<string, LinkPreview>();
  if (urls.length === 0) return out;
  const keys = new Map<string, string>();
  for (const u of urls) {
    const t = parseFetchableUrl(u);
    if (t) keys.set(t.href, u);
  }
  if (keys.size === 0) return out;
  const rows = await db.select().from(linkPreviews).where(inArray(linkPreviews.url, [...keys.keys()]));
  for (const r of rows) {
    const preview = toPreview(r);
    if (preview) out.set(keys.get(r.url)!, preview);
  }
  return out;
}

/** 取りにいく必要のある URL（まだ一度も取っていない・期限が切れた）。取りにいってよい URL だけ。 */
export async function staleLinkPreviewUrls(db: Db, urls: readonly string[], now: Date): Promise<string[]> {
  const targets = new Map<string, string>();
  for (const u of urls) {
    const t = parseFetchableUrl(u);
    if (t) targets.set(t.href, u);
  }
  if (targets.size === 0) return [];
  const rows = await db.select().from(linkPreviews).where(inArray(linkPreviews.url, [...targets.keys()]));
  const fresh = new Set(rows.filter((r) => isFresh(r, now)).map((r) => r.url));
  return [...targets].filter(([href]) => !fresh.has(href)).map(([, original]) => original);
}
