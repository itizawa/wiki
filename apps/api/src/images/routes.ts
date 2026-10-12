import { IMAGE_MAX_BYTES, imageNameFromPath, newImageName, sniffImageType } from "@wiki/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError, notFound } from "../errors";
import type { ImageStore } from "./store";
import { readBodyUpTo } from "./upload";

function requireStore(store: ImageStore | null | undefined): ImageStore {
  if (!store) throw new HttpError(503, "images_not_configured", "image storage is not configured");
  return store;
}

/**
 * 画像のアップロード（管理者のみ）。本文はファイルの中身そのまま（multipart にしない）。
 * 形式は中身から判定し、本文に書く相対パス `/images/{name}` を返す。
 */
export const imageUploadRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const store = requireStore(c.get("deps").images);
  const tooLarge = () => new HttpError(413, "image_too_large", `images must be ${IMAGE_MAX_BYTES} bytes or smaller`, { maxBytes: IMAGE_MAX_BYTES });
  const body = await readBodyUpTo(c.req.raw, IMAGE_MAX_BYTES, tooLarge);
  const type = sniffImageType(body);
  if (!type) throw new HttpError(415, "unsupported_image_type", "only PNG, JPEG, WebP and GIF images are accepted");
  const name = newImageName(type);
  await store.put(name, body, type);
  return c.json({ url: `/images/${name}` }, 201);
});

/**
 * 画像を配る。認証はしない（URL を知っていれば見られる）。名前は変わらないので、長くキャッシュさせる。
 * Workers の上では、この応答をエッジのキャッシュにも入れる（`worker.ts`）。ここに認証を足すなら、そちらも変える
 */
export const imageServeRoutes = new Hono<AppEnv>().get("/:name", async (c) => {
  const name = imageNameFromPath(`/images/${c.req.param("name")}`);
  const store = c.get("deps").images;
  const file = name && store ? await store.get(name) : null;
  if (!file) throw notFound("image");
  return new Response(file.body as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
