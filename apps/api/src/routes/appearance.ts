import {
  THEME_BACKGROUND_LIMIT_LABEL,
  THEME_BACKGROUND_MAX_BYTES,
  THEME_BACKGROUND_TYPES,
  THEME_IMAGE_LIMIT_LABEL,
  THEME_IMAGE_MAX_BYTES,
  THEME_IMAGE_TYPES,
  newImageName,
  sniffImageType,
  updateAppearanceInput,
} from "@wiki/shared";
import { Hono, type Context } from "hono";
import { auditActor } from "../audit/service";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { readBodyUpTo } from "../images/upload";
import { parseJson } from "../validation";
import { toAppearance, updateAppearance } from "../wikis/service";
import { requireWikiAdmin } from "./wikis";

/**
 * /admin/w/:wikiKey/appearance：公開サイトの「外観」（サイト名・テーマ・ロゴ・ファビコン・背景画像）。
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
  .post("/images", (c) =>
    uploadThemeImage(c, {
      maxBytes: THEME_IMAGE_MAX_BYTES,
      types: THEME_IMAGE_TYPES,
      limit: THEME_IMAGE_LIMIT_LABEL,
      subject: "logos and favicons",
      accepted: "PNG and WebP",
    }),
  )
  /** 背景画像のアップロード。PNG・JPEG・WebP の 2MB まで。保存先と配り方はロゴ・ファビコンと同じ */
  .post("/background-images", (c) =>
    uploadThemeImage(c, {
      maxBytes: THEME_BACKGROUND_MAX_BYTES,
      types: THEME_BACKGROUND_TYPES,
      limit: THEME_BACKGROUND_LIMIT_LABEL,
      subject: "background images",
      accepted: "PNG, JPEG and WebP",
    }),
  );

/** 外観の画像（ロゴ・ファビコン・背景画像）を、種類と大きさを確かめて置き、パスを返す */
async function uploadThemeImage(
  c: Context<AppEnv>,
  rule: { maxBytes: number; types: readonly string[]; limit: string; subject: string; accepted: string },
) {
  const store = c.get("deps").images;
  if (!store) throw new HttpError(503, "images_not_configured", "image storage is not configured");
  const tooLarge = () =>
    new HttpError(413, "image_too_large", `${rule.subject} must be ${rule.maxBytes} bytes or smaller`, { maxBytes: rule.maxBytes, limit: rule.limit });
  const body = await readBodyUpTo(c.req.raw, rule.maxBytes, tooLarge);
  const type = sniffImageType(body);
  if (!type || !rule.types.includes(type)) {
    throw new HttpError(415, "unsupported_image_type", `only ${rule.accepted} images are accepted for ${rule.subject}`, { limit: rule.limit });
  }
  const name = newImageName(type);
  await store.put(name, body, type);
  return c.json({ url: `/images/${name}` }, 201);
}
