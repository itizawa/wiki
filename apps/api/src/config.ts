export type AppConfig = {
  /** セッションCookieの署名鍵（32文字以上） */
  sessionSecret: string;
  /** 管理画面のオリジン。ログイン後のリダイレクト先とCSRF検査に使う */
  adminOrigin: string;
  /** Google OAuthのコールバックURL（例: https://admin.example.com/api/auth/google/callback） */
  googleRedirectUri: string;
  google: { clientId: string; clientSecret: string } | null;
  /** ローカル開発専用。Googleを経由せずこのメールでログインできる（無ければオーナーとして作る。production では無視） */
  devLoginEmail?: string;
  secureCookies: boolean;
  /** 公開サイトのドメインの共通部分。wiki は `{key}.{siteBaseDomain}` で公開する */
  siteBaseDomain: string;
  /** /export/public と /internal/* 用のトークン（ワーカー・サイトのビルドが使う）。未設定なら無効 */
  internalToken?: string;
};

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
    internalToken: env.INTERNAL_TOKEN || undefined,
  };
}
