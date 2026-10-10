import { StructureOpError, StructureValidationError } from "@wiki/shared";
import { Hono } from "hono";
import { authRoutes, requireAdmin } from "./auth/routes";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./errors";
import { exportRoutes, internalRoutes } from "./routes/internal";
import { pageRoutes } from "./routes/pages";
import { pagePublishRoutes, scheduleRoutes } from "./routes/publishing";
import { ruleRoutes } from "./routes/rules";
import { searchRoutes } from "./routes/search";
import { structureRoutes, treeRoutes } from "./routes/structure";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  // 状態を変えるリクエストは管理画面のオリジンからのみ受け付ける（CSRF対策）。
  // /internal はCookieを使わずトークンで認証するので対象外
  app.use("*", async (c, next) => {
    const safe =
      c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS" || c.req.path.startsWith("/internal/");
    if (!safe && c.req.header("origin") !== deps.config.adminOrigin) {
      throw new HttpError(403, "bad_origin", "cross-origin request rejected");
    }
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes);
  app.route("/export", exportRoutes);
  app.route("/internal", internalRoutes);

  const admin = new Hono<AppEnv>();
  admin.use("*", requireAdmin);
  admin.get("/me", (c) => c.json({ email: c.get("adminEmail") }));
  admin.get("/settings", (c) => c.json({ siteOrigin: deps.config.siteOrigin }));
  admin.route("/pages", pageRoutes);
  admin.route("/pages", pagePublishRoutes);
  admin.route("/schedule", scheduleRoutes);
  admin.route("/rules", ruleRoutes);
  admin.route("/search", searchRoutes);
  admin.route("/structure", structureRoutes);
  admin.route("/trees", treeRoutes);
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
