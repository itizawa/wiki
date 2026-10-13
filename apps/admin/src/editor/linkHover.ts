import { excerpt } from "@wiki/shared";
import { internalPageIdOf } from "../lib/internalPage";

/** ホバーしてから出すまでの待ち（ms）。編集中にカーソルが通るたびに出ないよう、公開サイトより長くする */
export const HOVER_DELAY_MS = 500;

/** プレビューの中身。 */
export type HoverPreview = { title: string; icon?: string | null; text?: string | null; site?: string | null };

export type HoverTarget = { kind: "page"; id: string } | { kind: "external"; url: string };

/** リンク先の種類。この wiki のページか、外部の http(s) の URL。それ以外（mailto・ページ内リンクなど）は null で、プレビューを出さない。 */
export function hoverTargetOf(href: string): HoverTarget | null {
  const id = internalPageIdOf(href);
  if (id) return { kind: "page", id };
  return /^https?:\/\//i.test(href.trim()) ? { kind: "external", url: href.trim() } : null;
}

/** ページの版の本文から、プレビューに出す抜粋を作る。 */
export const pagePreview = (page: { title: string; icon: string | null; head: { bodyMd: string } }): HoverPreview => ({
  title: page.title,
  icon: page.icon,
  text: excerpt(page.head.bodyMd, 140) || null,
});
