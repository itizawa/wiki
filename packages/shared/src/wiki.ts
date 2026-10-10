import { z } from "zod";

/**
 * wiki = ページ・ツリー（1本）・ルール・予約・設定のまとまり。wiki どうしは内容を共有しない。
 * key は公開サイトのサブドメイン（`{key}.{baseDomain}`）になり、作成後は変えられない。
 */
export type Wiki = {
  id: string;
  key: string;
  /** 表示名。公開サイトの名前として使う。あとから変えられる */
  name: string;
  /** 公開サイトのオリジン（末尾のスラッシュなし） */
  origin: string;
  /** アーカイブした日時。null なら使用中 */
  archivedAt: string | null;
  createdAt: string;
};

export const WIKI_KEY_MIN = 3;
export const WIKI_KEY_MAX = 32;

/**
 * 使えない key。ほかの Worker が使っているサブドメインと、wiki の内容と紛らわしいもの。
 * 公開サイトの Worker も、これらのホスト名には応答しない。
 */
export const RESERVED_WIKI_KEYS: readonly string[] = [
  "wiki-admin",
  "wiki-site",
  "wiki-worker",
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "smtp",
  "static",
  "assets",
  "cdn",
  "auth",
  "login",
  "status",
];

export type WikiKeyCheck = { id: "chars" | "length" | "edges" | "reserved"; label: string; ok: boolean };

/** key の決まりを1つずつ確かめる（入力欄のそばに、どれを満たしたかを出すため）。 */
export function checkWikiKey(key: string): WikiKeyCheck[] {
  return [
    { id: "chars", label: "半角の英小文字・数字・ハイフンだけを使う", ok: /^[a-z0-9-]+$/.test(key) },
    { id: "length", label: `${WIKI_KEY_MIN}〜${WIKI_KEY_MAX}文字`, ok: key.length >= WIKI_KEY_MIN && key.length <= WIKI_KEY_MAX },
    { id: "edges", label: "先頭は英字、末尾はハイフン以外", ok: /^[a-z]/.test(key) && !key.endsWith("-") },
    { id: "reserved", label: "予約された名前（www・api・admin など）ではない", ok: key !== "" && !RESERVED_WIKI_KEYS.includes(key) },
  ];
}

export function isValidWikiKey(key: string): boolean {
  return checkWikiKey(key).every((c) => c.ok);
}

export const wikiKeySchema = z.string().refine(isValidWikiKey, { message: "invalid wiki key" });

const wikiName = z.string().trim().min(1).max(100);

export const createWikiInput = z.object({ key: wikiKeySchema, name: wikiName });
export type CreateWikiInput = z.infer<typeof createWikiInput>;

export const renameWikiInput = z.object({ name: wikiName });
export type RenameWikiInput = z.infer<typeof renameWikiInput>;

/**
 * wiki の公開サイトのオリジン。`{key}.{baseDomain}`。
 * 手元の開発（baseDomain が localhost）だけ http にする。
 */
export function wikiOrigin(key: string, baseDomain: string): string {
  const scheme = /^localhost(:\d+)?$/.test(baseDomain) ? "http" : "https";
  return `${scheme}://${key}.${baseDomain}`;
}

/**
 * ホスト名（ポートつきでもよい）から wiki の key を取り出す。
 * baseDomain の直下のサブドメインで、key として正しいものだけを返す。それ以外は null。
 */
export function wikiKeyFromHost(host: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain.toLowerCase()}`;
  const name = host.toLowerCase();
  if (!name.endsWith(suffix)) return null;
  const key = name.slice(0, -suffix.length);
  return isValidWikiKey(key) ? key : null;
}

/** 管理画面の一覧用。アーカイブの確認に使う件数を含む。 */
export type WikiSummary = Wiki & {
  /** 公開サイトに出ているページ（公開・限定公開）の件数 */
  publishedPages: number;
};
