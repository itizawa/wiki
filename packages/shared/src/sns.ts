import { z } from "zod";

/**
 * SNS 連携：wiki ごとに、その wiki の SNS アカウントをつなぐ。いまは X だけ。
 * つなぐのは wiki の管理者（とオーナー）。つないだアカウントへは、管理画面からポストできる。
 */

export const SNS_PROVIDERS = ["x"] as const;
export type SnsProvider = (typeof SNS_PROVIDERS)[number];

export const SNS_PROVIDER_LABELS: Record<SnsProvider, string> = { x: "X" };

/** つないである SNS アカウント。トークンは含めない。 */
export type SnsAccount = {
  /** `@` を除いたユーザー名（つないだ時点、または最後に確かめた時点のもの） */
  username: string;
  /** 表示名 */
  displayName: string;
  /** つないだ人の名前（無ければメールアドレス）。その時点の値 */
  connectedBy: string;
  connectedAt: string;
};

export type SnsStatus = {
  x: {
    /** この管理画面に X の開発者アプリの設定（`X_CLIENT_ID` など）があるか。無ければ連携できない */
    available: boolean;
    account: SnsAccount | null;
  };
};

/** X のプロフィールの URL。 */
export function xProfileUrl(username: string): string {
  return `https://x.com/${encodeURIComponent(username)}`;
}

/** X のポストの URL。 */
export function xPostUrl(username: string, postId: string): string {
  return `${xProfileUrl(username)}/status/${encodeURIComponent(postId)}`;
}

/** X の1ポストの上限（重みつきの長さ）。半角は1、全角（日本語など）は2と数えるので、日本語だけなら140文字。 */
export const X_POST_MAX_WEIGHT = 280;
/** URL は、長さにかかわらずこの長さとして数える（X が t.co の短い URL に置き換えるため）。 */
const X_URL_WEIGHT = 23;
const URL_PATTERN = /https?:\/\/[^\s　]+/g;

/** 1と数える文字の範囲（X の決まり。これ以外は2）。 */
function isLightCodePoint(cp: number): boolean {
  return cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
}

/**
 * ポストの長さを X の数え方で数える（上限は `X_POST_MAX_WEIGHT`）。
 * 絵文字の合成（1つの絵文字を2と数える）までは追わず、符号位置ごとに数えるので、合成した絵文字は X より多めに出る。
 */
export function xPostWeight(text: string): number {
  let weight = 0;
  const rest = text.normalize("NFC").replace(URL_PATTERN, () => {
    weight += X_URL_WEIGHT;
    return "";
  });
  for (const ch of rest) weight += isLightCodePoint(ch.codePointAt(0)!) ? 1 : 2;
  return weight;
}

/** テスト投稿の文面。前後の空白は落とす。 */
export const snsTestPostInput = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((v) => xPostWeight(v) <= X_POST_MAX_WEIGHT, { message: "text is too long for a post" }),
});
export type SnsTestPostInput = z.infer<typeof snsTestPostInput>;

/** ポストした結果。 */
export type SnsPostResult = { id: string; url: string };

/** X の認可のあと、管理画面に戻るときに URL に付ける結果（`?x=`）。 */
export const X_CONNECT_RESULTS = ["connected", "denied", "expired", "forbidden", "failed"] as const;
export type XConnectResult = (typeof X_CONNECT_RESULTS)[number];
