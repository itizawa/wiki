/** Google のサービスアカウントの鍵のうち、使うものだけ */
export type GoogleServiceAccount = { clientEmail: string; privateKey: string };

export type AppConfig = {
  /** セッションCookieの署名鍵（32文字以上） */
  sessionSecret: string;
  /** 管理画面のオリジン。ログイン後のリダイレクト先とCSRF検査に使う */
  adminOrigin: string;
  /** Google OAuthのコールバックURL（例: https://admin.example.com/api/auth/google/callback） */
  googleRedirectUri: string;
  google: { clientId: string; clientSecret: string } | null;
  /** ローカル開発専用。Googleを経由せず、このメールのユーザーをオーナーとして作ってログインできる（production では無視） */
  devLoginEmail?: string;
  secureCookies: boolean;
  /** 公開サイトのドメインの共通部分。wiki は `{key}.{siteBaseDomain}` で公開する */
  siteBaseDomain: string;
  /** /export/public 用のトークン（公開サイトのビルドだけが持つ）。未設定なら、その経路は無効 */
  exportToken?: string;
  /** /internal/* 用のトークン（Cron のワーカーだけが持つ）。未設定なら、その経路は無効 */
  cronToken?: string;
  /**
   * 「アクセス解析」が Google Analytics とサーチコンソールの数字を読むためのサービスアカウント。
   * null：未設定（この機能は無効）。"invalid"：登録してあるが、鍵の JSON として読めない
   */
  googleServiceAccount: GoogleServiceAccount | "invalid" | null;
};

/**
 * `GOOGLE_SERVICE_ACCOUNT_JSON`（Google Cloud でダウンロードした鍵の JSON そのまま）を読む。
 * 読めなくても投げない（設定はリクエストのたびに読むので、ここで投げると、ほかの画面まで止まる）。中身はログに出さない。
 */
export function parseServiceAccount(json: string | undefined): AppConfig["googleServiceAccount"] {
  if (!json || json.trim() === "") return null;
  try {
    const key = JSON.parse(json) as { client_email?: unknown; private_key?: unknown };
    if (typeof key.client_email !== "string" || !key.client_email.includes("@")) return "invalid";
    if (typeof key.private_key !== "string" || !key.private_key.includes("PRIVATE KEY")) return "invalid";
    return { clientEmail: key.client_email, privateKey: key.private_key };
  } catch {
    return "invalid";
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const required = (key: string) => {
    const v = env[key];
    if (!v) throw new Error(`${key} is required`);
    return v;
  };
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const isProduction = env.NODE_ENV === "production";
  const adminOrigin = env.ADMIN_ORIGIN ?? "http://localhost:5173";
  return {
    sessionSecret,
    adminOrigin,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI ?? `${adminOrigin}/api/auth/google/callback`,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    devLoginEmail: isProduction ? undefined : env.DEV_LOGIN_EMAIL?.toLowerCase(),
    secureCookies: isProduction || adminOrigin.startsWith("https://"),
    siteBaseDomain: env.SITE_BASE_DOMAIN ?? "localhost:4321",
    exportToken: env.EXPORT_TOKEN || undefined,
    cronToken: env.CRON_TOKEN || undefined,
    googleServiceAccount: parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON),
  };
}
