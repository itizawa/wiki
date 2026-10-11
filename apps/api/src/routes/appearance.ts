import { THEME_IMAGE_LIMIT_LABEL, THEME_IMAGE_MAX_BYTES, THEME_IMAGE_TYPES, newImageName, sniffImageType, updateAppearanceInput } from "@wiki/shared";
import { Hono } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { readBodyUpTo } from "../images/upload";
import { parseJson } from "../validation";
import { toAppearance, updateAppearance } from "../wikis/service";
import { requireWikiAdmin } from "./wikis";

/**
 * /admin/w/:wikiKey/appearance：公開サイトの「外観」（サイト名・アクセント色・ロゴ・ファビコン）。
 * 見るのも変えるのも、wiki の管理者（とオーナー）だけ。
 */
export const appearanceRoutes = new Hono<AppEnv>()
  .use("*", requireWikiAdmin)
  .get("/", (c) => c.json(toAppearance(c.get("wiki"))))
  .put("/", async (c) => {
    const input = await parseJson(c, updateAppearanceInput);
    return c.json(await updateAppearance(c.get("deps").db, c.get("wiki").id, input, auditActor(c)));
  })
  /**
   * ロゴ・ファビコンのアップロード。本文の画像より狭く、PNG・WebP の 512KB まで。
   * 置き場所は本文の画像と同じで、返したパスを「外観」の保存で指定する
   */
  .post("/images", async (c) => {
    const store = c.get("deps").images;
    if (!store) throw new HttpError(503, "images_not_configured", "image storage is not configured");
    const tooLarge = () =>
      new HttpError(413, "image_too_large", `logos and favicons must be ${THEME_IMAGE_MAX_BYTES} bytes or smaller`, {
        maxBytes: THEME_IMAGE_MAX_BYTES,
        limit: THEME_IMAGE_LIMIT_LABEL,
      });
    const body = await readBodyUpTo(c.req.raw, THEME_IMAGE_MAX_BYTES, tooLarge);
    const type = sniffImageType(body);
    if (!type || !(THEME_IMAGE_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(415, "unsupported_image_type", "only PNG and WebP images are accepted for logos and favicons", {
        limit: THEME_IMAGE_LIMIT_LABEL,
      });
    }
    const name = newImageName(type);
    await store.put(name, body, type);
    return c.json({ url: `/images/${name}` }, 201);
  });
