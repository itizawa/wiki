import { parsePageSegment, type PublicRoutes } from "@wiki/shared";

/** 記録用の経路。記事のページのスクリプトが、同じオリジンへ記事の ID だけを送る（navigator.sendBeacon） */
export const VIEW_PATH = "/_v";

export type ViewEnv = {
  /** API（wiki-admin）のオリジン。無ければ数えない */
  API_ORIGIN?: string;
  /** API の /internal/* 用のトークン（secret）。無ければ数えない */
  INTERNAL_TOKEN?: string;
  /** 回数の制限（Workers の Rate Limiting）。無ければ制限しない */
  VIEW_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

type Ctx = { waitUntil(promise: Promise<unknown>): void };

/**
 * Bot の User-Agent。JavaScript を動かすクローラー（Googlebot など）と、自動操作・プレビューの取得に使われるものを除く。
 * 偽った User-Agent までは見分けられない（数は目安）。
 */
const BOT_UA =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|chrome-lighthouse|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|quora link|whatsapp|vkshare|curl|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici/i;

export function isBotUserAgent(ua: string | null): boolean {
  return !ua || BOT_UA.test(ua);
}

/** Cloudflare が確認済みの Bot としているリクエスト。Bot Management のある（Enterprise の）プランでだけ値が入り、それ以外では常に false */
function isVerifiedBot(request: Request): boolean {
  const cf = (request as { cf?: { botManagement?: { verifiedBot?: boolean } } }).cf;
  return cf?.botManagement?.verifiedBot === true;
}

/** 先読み（prefetch / prerender）のリクエスト。スクリプトは表示されてから送るが、念のため受け取る側でも除く */
function isPrefetch(request: Request): boolean {
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  return /prefetch|prerender/i.test(purpose);
}

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

/**
 * `POST /_v`：記事の閲覧1回を受け取り、確かめてから API へ渡す。数えたかどうかにかかわらず、いつも 204 を返す。
 * - 送られてくるのは記事の ID だけ。IP アドレス・Cookie・個人を見分ける値は API へ送らない
 *   （回数の制限には接続元の IP を鍵に使うが、Cloudflare の中で数えるだけで、どこにも残さない）
 * - 数えるのは、その wiki の page-routes.json にある（いま公開している）記事だけ。限定公開・非公開・ほかの wiki の記事は無い
 * - 渡すのは応答を返したあと（ctx.waitUntil）。失敗しても記事の表示には関わらず、数が静かに欠ける
 */
export async function recordView(
  request: Request,
  env: ViewEnv,
  ctx: Ctx | undefined,
  wiki: string,
  routes: () => Promise<PublicRoutes | null>,
): Promise<Response> {
  if (!env.API_ORIGIN || !env.INTERNAL_TOKEN) return NO_CONTENT();
  if (isBotUserAgent(request.headers.get("user-agent")) || isVerifiedBot(request) || isPrefetch(request)) return NO_CONTENT();

  const body = (await request.text().catch(() => "")).trim();
  const pageId = body.length <= 32 ? parsePageSegment(body)?.id : undefined;
  if (!pageId || pageId !== body) return NO_CONTENT();

  if (env.VIEW_LIMITER) {
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const { success } = await env.VIEW_LIMITER.limit({ key: ip }).catch(() => ({ success: true }));
    if (!success) return NO_CONTENT();
  }

  const table = await routes();
  if (!table || !Object.hasOwn(table.canonical, pageId)) return NO_CONTENT();

  const send = fetch(new URL("/internal/views", env.API_ORIGIN), {
    method: "POST",
    headers: { authorization: `Bearer ${env.INTERNAL_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ wiki, pageId }),
  }).then(
    (res) => {
      if (!res.ok) console.warn(`views: the API answered ${res.status}`);
    },
    (err) => console.warn("views: failed to reach the API", err),
  );
  if (ctx) ctx.waitUntil(send);
  else await send;
  return NO_CONTENT();
}
