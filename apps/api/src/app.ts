import { StructureOpError, StructureValidationError } from "@wiki/shared";
import { Hono } from "hono";
import { authRoutes, requireAdmin } from "./auth/routes";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./errors";
import { imageServeRoutes, imageUploadRoutes } from "./images/routes";
import { mcpRoutes } from "./mcp/server";
import { oauthAdminRoutes, oauthRoutes, wellKnownRoutes } from "./oauth/routes";
import { exportRoutes, internalRoutes } from "./routes/internal";
import { pageRoutes } from "./routes/pages";
import { pagePublishRoutes, scheduleRoutes } from "./routes/publishing";
import { ruleRoutes } from "./routes/rules";
import { searchRoutes } from "./routes/search";
import { starRoutes } from "./routes/stars";
import { structureRoutes, treeRoutes } from "./routes/structure";
import { isOwner, resolveWiki, wikiRoutes } from "./routes/wikis";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
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
  // 外部のアプリ（MCP クライアント）：OAuth 2.1 の認可サーバーと、MCP サーバー
  app.route("/.well-known", wellKnownRoutes);
  app.route("/oauth", oauthRoutes);
  app.route("/mcp", mcpRoutes);

  const admin = new Hono<AppEnv>();
  admin.use("*", requireAdmin);
  admin.get("/me", (c) => c.json({ email: c.get("adminEmail"), isOwner: isOwner(deps.config, c.get("adminEmail")) }));
  admin.route("/wikis", wikiRoutes);
  admin.route("/oauth", oauthAdminRoutes);

  // wiki の内容は、すべて wiki を経路に入れて扱う。ページの ID だけを指定する経路でも、その wiki のものかを確かめる
  const wiki = new Hono<AppEnv>();
  wiki.use("*", resolveWiki);
  wiki.route("/pages", pageRoutes);
  wiki.route("/pages", pagePublishRoutes);
  wiki.route("/schedule", scheduleRoutes);
  wiki.route("/rules", ruleRoutes);
  wiki.route("/search", searchRoutes);
  wiki.route("/stars", starRoutes);
  wiki.route("/structure", structureRoutes);
  wiki.route("/trees", treeRoutes);
  wiki.route("/images", imageUploadRoutes);
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
