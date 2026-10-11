import { jstDay, parsePageSegment, type PublicRoutes } from "@wiki/shared";

/** 記録用の経路。記事のページのスクリプトが、同じオリジンへ記事の ID だけを送る（navigator.sendBeacon） */
export const VIEW_PATH = "/_v";

/** Workers Analytics Engine のデータセットのバインディングのうち、ここで使う部分 */
export type ViewDataset = {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
};

export type ViewEnv = {
  /**
   * 閲覧を貯める先（Workers Analytics Engine。`wrangler.toml` の `[[analytics_engine_datasets]]`）。無ければ数えない。
   * 1時間に1回、Cron のワーカー（apps/worker）がここから集計して、API 経由で DB に反映する
   */
  PAGE_VIEWS?: ViewDataset;
  /** 回数の制限（Workers の Rate Limiting）。無ければ制限しない */
  VIEW_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

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
 * `POST /_v`：記事の閲覧1回を受け取り、確かめてから Workers Analytics Engine に1行書く。数えたかどうかにかかわらず、いつも 204 を返す。
 * - ここでは API も DB も呼ばない。貯めたものは、1時間に1回 Cron のワーカーが集計して DB に反映する
 * - 書くのは wiki の key・記事の ID・JST の日付だけ。IP アドレス・Cookie・個人を見分ける値は書かない
 *   （回数の制限には接続元の IP を鍵に使うが、Cloudflare の中で数えるだけで、どこにも残さない）
 * - 数えるのは、その wiki の page-routes.json にある（いま公開している）記事だけ。限定公開・非公開・ほかの wiki の記事は無い
 * - 書き込みは待たない（`writeDataPoint` は応答を返したあとに送られる）。失敗しても記事の表示には関わらず、数が静かに欠ける
 *
 * 1行の形（集計する側の apps/worker/src/views.ts と合わせる）：
 * - blob1 = wiki の key、blob2 = 記事の ID、blob3 = JST の日付（`YYYY-MM-DD`。集計のときにタイムゾーンの計算をしなくて済む）
 * - double1 = 1（閲覧1回）
 * - index1 = `{wiki の key}:{記事の ID}`（間引き（サンプリング）は index ごとに行われるので、記事ごとの数が保たれる）
 */
export async function recordView(
  request: Request,
  env: ViewEnv,
  wiki: string,
  routes: () => Promise<PublicRoutes | null>,
  now: Date = new Date(),
): Promise<Response> {
  if (!env.PAGE_VIEWS) return NO_CONTENT();
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

  try {
    env.PAGE_VIEWS.writeDataPoint({ blobs: [wiki, pageId, jstDay(now)], doubles: [1], indexes: [`${wiki}:${pageId}`] });
  } catch (err) {
    console.warn("views: the data point was not written", err);
  }
  return NO_CONTENT();
}
