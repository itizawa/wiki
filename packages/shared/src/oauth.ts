/**
 * 外部のアプリ（MCP クライアント）に与える権限。読む以外は、同意の画面で一つずつ選ぶ。
 * 限定公開URLの再発行・wiki の管理は、どのスコープでもできない。
 */
export const OAUTH_SCOPES = {
  "wiki.read": { label: "公開中のページを読む", required: true },
  "wiki.write": { label: "ページを作る・本文を更新する・移動する", required: false },
  "wiki.private": { label: "非公開・限定公開のページも読む・書く（本文が外のサービスへ送られます）", required: false },
  "wiki.publish": { label: "公開・非公開化・予約をする（人の確認を通さずに公開されます）", required: false },
  "wiki.delete": { label: "ページを削除する（ゴミ箱に入れる・元に戻す）", required: false },
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPES;

export const isOAuthScope = (s: string): s is OAuthScope => Object.hasOwn(OAUTH_SCOPES, s);

/** 同意の画面に出す、アプリからの依頼 */
export type OAuthConsentRequest = {
  client: { id: string; name: string; redirectHost: string };
  scopes: OAuthScope[];
};

/** 管理画面の「外部アプリ連携」に出す、与えた許可 */
export type OAuthGrantSummary = {
  id: string;
  clientName: string;
  redirectHosts: string[];
  scopes: OAuthScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};
