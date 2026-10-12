import type { LinkPreview } from "@wiki/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../errors";
import { getLinkPreview, isFetchableUrl } from "../linkPreview/service";
import { RATE_LIMIT_PERIOD_SEC, withinRateLimit } from "../rate-limit";

const MAX_URL_LENGTH = 2000;

/**
 * 外部の URL の OGP を返す（ブラウザから外部サイトの HTML は CORS で読めないので、API が代わりに取る）。
 * wiki のメンバーだけが呼べて、呼ぶ回数に制限がある（人ごと。wrangler.toml の LINK_PREVIEW_LIMITER）。
 * 取りにいく先は https・443・ドメイン名だけ（linkPreview/url.ts）。許されない URL は 400、取れなかったものは `preview: null`。
 * 結果は link_previews に保存し、7日（取れなかったものは1時間）は取り直さない。
 */
export const linkPreviewRoutes = new Hono<AppEnv>().get("/", async (c) => {
  if (!(await withinRateLimit(c, "linkPreview", c.get("user").id))) {
    return c.json({ error: { code: "rate_limited", message: "too many requests" } }, 429, { "retry-after": String(RATE_LIMIT_PERIOD_SEC) });
  }
  const url = c.req.query("url") ?? "";
  if (url.length > MAX_URL_LENGTH || !isFetchableUrl(url)) throw new HttpError(400, "invalid_url", "this URL cannot be previewed");
  const { db, linkFetch } = c.get("deps");
  const preview: LinkPreview | null = await getLinkPreview(db, url, { fetch: linkFetch ?? undefined });
  return c.json({ preview });
});
