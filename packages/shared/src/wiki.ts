import { z } from "zod";
import { SITE_NAME_MAX } from "./theme";
import type { WikiRole } from "./users";
import { isGaPropertyId } from "./analytics";
import { imageNameFromPath } from "./images";

/**
 * wiki = ページ・ツリー（1本）・予約・設定のまとまり。wiki どうしは内容を共有しない。
 * key は公開サイトのサブドメイン（`{key}.{baseDomain}`）になり、作成後は変えられない。
 */
export type Wiki = {
  id: string;
  key: string;
  /** 表示名。公開サイトの名前として使う。あとから変えられる */
  name: string;
  /** 管理画面で wiki を見分けるための画像（アイコン）。http(s) の URL か、アップロードした画像のパス（`/images/{name}`）。null なら表示名の頭文字を出す */
  iconUrl: string | null;
  /** 公開サイトのオリジン（末尾のスラッシュなし） */
  origin: string;
  /** アーカイブした日時。null なら使用中 */
  archivedAt: string | null;
  createdAt: string;
  /** 公開サイトを出しているか。false の間は、ページごとの公開範囲は変えずに、サイトをだれも見られない */
  sitePublic: boolean;
} & WikiSettings;

/**
 * wiki ごとの設定のうち、外部サービスとの連携。null なら未設定。
 * 測定 ID と確認用の値は公開サイトの HTML にそのまま出るので、決まった形のものだけを持つ（どちらも null ならタグを出さない）。
 */
export type WikiSettings = {
  /** Google Analytics（GA4）の測定 ID（`G-` で始まる） */
  gaMeasurementId: string | null;
  /** Google サーチコンソールの確認用の値（`<meta name="google-site-verification">` の `content` の中身） */
  searchConsoleVerification: string | null;
  /** GA4 のプロパティ ID（数字だけ）。管理画面の「アクセス解析」が数字を読むのに使う。公開サイトには出さない */
  gaPropertyId: string | null;
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

/** 表示名は公開サイトの名前（ヘッダー・タイトル・RSS・フッター）になる */
const wikiName = z.string().trim().min(1).max(SITE_NAME_MAX);

export const WIKI_ICON_URL_MAX = 2048;

/** http(s) の URL か。`javascript:` や `data:` などは通さない。 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * wiki の画像として使える値か。http(s) の URL か、アップロードした画像のパス（`/images/{name}`）。
 * それ以外の相対パスは通さない。
 */
export function isWikiIconUrl(value: string): boolean {
  return isHttpUrl(value) || imageNameFromPath(value) !== null;
}

/** wiki の画像の URL。外すときは null。 */
export const wikiIconUrl = z
  .string()
  .trim()
  .max(WIKI_ICON_URL_MAX)
  .refine(isWikiIconUrl, { message: "icon url must be http(s) or an uploaded image path" })
  .nullable();

export const createWikiInput = z.object({ key: wikiKeySchema, name: wikiName, iconUrl: wikiIconUrl.optional() });
export type CreateWikiInput = z.infer<typeof createWikiInput>;

/** 表示名と画像の変更。どちらか一方だけでもよい。 */
export const updateWikiInput = z
  .object({ name: wikiName.optional(), iconUrl: wikiIconUrl.optional() })
  .refine((v) => v.name !== undefined || v.iconUrl !== undefined, { message: "nothing to update" });
export type UpdateWikiInput = z.infer<typeof updateWikiInput>;

/** GA4 の測定 ID の形。`UA-`（ユニバーサルアナリティクス）・`GTM-`・`AW-` は通さない。 */
const GA_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;
/** サーチコンソールの確認用の値の形（`content` の中身だけ）。`<`・`"`・空白などは通さない。 */
const SEARCH_CONSOLE_VERIFICATION = /^[A-Za-z0-9_-]{1,100}$/;

export function isGaMeasurementId(value: string): boolean {
  return GA_MEASUREMENT_ID.test(value);
}

export function isSearchConsoleVerification(value: string): boolean {
  return SEARCH_CONSOLE_VERIFICATION.test(value);
}

/**
 * サーチコンソールの確認用の値を、貼られたものから取り出す。
 * タグごと貼られたとき（`<meta name="google-site-verification" content="..." />`）は `content` の値を返し、
 * それ以外は前後の空白を落としただけのものを返す（形の確かめは isSearchConsoleVerification で行う）。
 */
export function extractSearchConsoleVerification(pasted: string): string {
  const text = pasted.trim();
  if (!/^<meta\b/i.test(text)) return text;
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(text);
  return content ? (content[1] ?? content[2] ?? content[3] ?? "").trim() : text;
}

/** 連携の値。前後の空白は落とす。外すときは null（空の文字列も、外すものとして受ける）。 */
const settingValue = (ok: (value: string) => boolean, message: string) =>
  z
    .string()
    .trim()
    .nullable()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || ok(v), { message });

/** 連携の設定の変更。どれか1つだけでもよい。 */
export const updateWikiSettingsInput = z
  .object({
    gaMeasurementId: settingValue(isGaMeasurementId, "measurement id must look like G-XXXXXXXXXX").optional(),
    searchConsoleVerification: settingValue(isSearchConsoleVerification, "verification must be the content value of the meta tag").optional(),
    gaPropertyId: settingValue(isGaPropertyId, "property id must be digits only").optional(),
    sitePublic: z.boolean().optional(),
  })
  .refine((v) => v.gaMeasurementId !== undefined || v.searchConsoleVerification !== undefined || v.gaPropertyId !== undefined || v.sitePublic !== undefined, { message: "nothing to update" });
export type UpdateWikiSettingsInput = z.infer<typeof updateWikiSettingsInput>;

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
  /** ログインしている人の、この wiki でのロール（オーナーは管理者） */
  role: WikiRole;
  /** 外観で設定したファビコンのパス（`/images/{name}`）。未設定は null。管理画面のタブのアイコンに使う */
  faviconUrl: string | null;
};
