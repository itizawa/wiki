import { StructureOpError, StructureValidationError } from "@wiki/shared";
import { Hono } from "hono";
import { authRoutes, clearLegacyCookies, requireAccess, requireUser } from "./auth/routes";
import { appearanceRoutes } from "./routes/appearance";
import { homeRoutes } from "./routes/home";
import { collectCronMarks } from "./cron/marks";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./errors";
import { imageServeRoutes, imageUploadRoutes } from "./images/routes";
import { mcpRoutes } from "./mcp/server";
import { oauthAdminRoutes, oauthRoutes, wellKnownRoutes } from "./oauth/routes";
import { analyticsRoutes } from "./routes/analytics";
import { editRequestRoutes, wikiEditRequestRoutes } from "./routes/editRequests";
import { exportRoutes, internalRoutes } from "./routes/internal";
import { pageRoutes } from "./routes/pages";
import { pagePublishRoutes, scheduleRoutes } from "./routes/publishing";
import { searchRoutes } from "./routes/search";
import { starRoutes } from "./routes/stars";
import { structureRoutes, treeRoutes } from "./routes/structure";
import { inviteAdminRoutes, inviteRoutes, memberRoutes, userRoutes } from "./routes/members";
import { templateRoutes } from "./routes/templates";
import { globalAuditRoutes, wikiAuditRoutes } from "./routes/audit";
import { resolveWiki, wikiRoutes, wikiSettingsRoutes } from "./routes/wikis";

/**
 * API の応答はどれも JSON かリダイレクトなので、何も読み込ませず、枠にも入れさせない。
 * 管理画面の HTML（静的アセット）のヘッダーは apps/admin/public/_headers で付ける。
 */
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  // Cron のワーカーへの印（下書きあり・予約あり・ビルド待ちあり）を、応答ができたあと（コミットのあと）に書く。
  // /internal/* はワーカー自身の呼び出しで、印はワーカーが応答を見て書き直すので、ここでは書かない
  app.use("*", async (c, next) => {
    if (!deps.cronMarks || c.req.path.startsWith("/internal/")) return next();
    await collectCronMarks(deps.cronMarks, next);
  });
  // 応答に付けるセキュリティヘッダー。経路が自分で付けたもの（画像の CSP など）は上書きしない
  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    }
  });
  // `__Host-` を付ける前の名前の Cookie は、セッションを見る経路に来たら消す（401 などのエラーの応答にも付ける）。
  // 画像（/images）のようにキャッシュさせる応答には Set-Cookie を付けない
  for (const path of ["/auth/*", "/admin/*", "/invites/*"]) app.use(path, clearLegacyCookies);
  // 状態を変えるリクエストは管理画面のオリジンからのみ受け付ける（CSRF対策）。
  // /internal・/oauth・/mcp はCookieを使わずトークン（またはPKCE）で認証するので対象外
  app.use("*", async (c, next) => {
    const path = c.req.path;
    const safe =
      c.req.method === "GET" ||
      c.req.method === "HEAD" ||
      c.req.method === "OPTIONS" ||
      path.startsWith("/internal/") ||
      path.startsWith("/oauth/") ||
      path === "/mcp" ||
      path.startsWith("/mcp/");
    if (!safe && c.req.header("origin") !== deps.config.adminOrigin) {
      throw new HttpError(403, "bad_origin", "cross-origin request rejected");
    }
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes);
  app.route("/export", exportRoutes);
  app.route("/internal", internalRoutes);
  app.route("/images", imageServeRoutes);
  // 招待リンクを開いた人向け。メンバーでなくても使える
  app.route("/invites", inviteRoutes);
  // 外部のアプリ（MCP クライアント）：OAuth 2.1 の認可サーバーと、MCP サーバー
  app.route("/.well-known", wellKnownRoutes);
  app.route("/oauth", oauthRoutes);
  app.route("/mcp", mcpRoutes);

  // ログインしていて、オーナーか、どれかの wiki のメンバーである人だけ。リクエストのたびに DB で確かめる
  const admin = new Hono<AppEnv>();
  // wiki の経路は、セッションの人・wiki・ロールを1本のクエリで引く。下の2つよりも先に掛け、同じことを引き直させない。
  // wiki の内容は、すべて wiki を経路に入れて扱う。ページの ID だけを指定する経路でも、その wiki のものかを確かめる
  admin.use("/w/:wikiKey/*", resolveWiki);
  admin.use("*", requireUser, requireAccess);
  admin.get("/me", (c) => {
    const user = c.get("user");
    return c.json({ id: user.id, email: user.email, name: user.name, isOwner: user.isOwner });
  });
  admin.route("/wikis", wikiRoutes);
  admin.route("/users", userRoutes);
  admin.route("/audit-logs", globalAuditRoutes);
  admin.route("/oauth", oauthAdminRoutes);

  const wiki = new Hono<AppEnv>();
  wiki.route("/pages", pageRoutes);
  wiki.route("/pages", pagePublishRoutes);
  wiki.route("/pages", editRequestRoutes);
  wiki.route("/edit-requests", wikiEditRequestRoutes);
  wiki.route("/schedule", scheduleRoutes);
  wiki.route("/templates", templateRoutes);
  wiki.route("/search", searchRoutes);
  wiki.route("/stars", starRoutes);
  wiki.route("/structure", structureRoutes);
  wiki.route("/trees", treeRoutes);
  wiki.route("/images", imageUploadRoutes);
  wiki.route("/members", memberRoutes);
  wiki.route("/invites", inviteAdminRoutes);
  wiki.route("/audit-logs", wikiAuditRoutes);
  wiki.route("/appearance", appearanceRoutes);
  wiki.route("/home", homeRoutes);
  wiki.route("/settings", wikiSettingsRoutes);
  wiki.route("/analytics", analyticsRoutes);
  admin.route("/w/:wikiKey", wiki);
  app.route("/admin", admin);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "not found" } }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    if (err instanceof StructureOpError) {
      return c.json({ error: { code: err.code, message: err.message, details: { opIndex: err.opIndex } } }, 422);
    }
    if (err instanceof StructureValidationError) {
      return c.json({ error: { code: "invalid_structure", message: err.message, details: err.issues } }, 422);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "internal error" } }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
