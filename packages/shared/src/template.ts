import { z } from "zod";
import { isoToJstLocal } from "./time";

/**
 * テンプレート = 新しいページのひな形（議事録のように、同じ形のページを繰り返し作るためのもの）。
 * ページとは別に持ち、ツリーにも公開サイトにも出さない。
 */
export type PageTemplate = {
  id: string;
  title: string;
  bodyMd: string;
  createdAt: string;
  updatedAt: string;
};

export const templateInput = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(500_000).default(""),
});
export type TemplateInput = z.infer<typeof templateInput>;

/** ページを作るときに置き換える変数。 */
export const TEMPLATE_VARIABLES = [
  { name: "{date}", label: "今日の日付（例：2026-10-10）" },
  { name: "{datetime}", label: "今の日時（例：2026-10-10 09:30）" },
  { name: "{author}", label: "作った人（ログインしているメールアドレス）" },
] as const;

/** テンプレートの変数を置き換える。日時は JST。知らない `{…}` はそのまま残す。 */
export function fillTemplate(text: string, ctx: { now: Date; author: string }): string {
  const local = isoToJstLocal(ctx.now.toISOString());
  const values: Record<string, string> = {
    date: local.slice(0, 10),
    datetime: local.replace("T", " "),
    author: ctx.author,
  };
  return text.replace(/\{(date|datetime|author)\}/g, (_, name: string) => values[name]!);
}
