import type { APIContext } from "astro";
import { allWikis, navFile } from "../../lib/manifest";

export async function getStaticPaths() {
  return Promise.all((await allWikis()).map(async (w) => ({ params: { wiki: w.key, hash: (await navFile(w.key)).hash } })));
}

/**
 * ツリーナビの全体（wiki ごとに1つ。`/nav.{hash}.json`）。記事のページの HTML には最初の表示の分だけを入れ、残りはツリーナビがここから読む。
 * 入るのは、その wiki の公開ツリー（公開ページだけ。マニフェストの `trees`）。限定公開・非公開のページは、題名も id も入らない。
 * 名前に中身のハッシュが入るので、ブラウザに長くキャッシュさせる（worker/index.ts）。
 */
export async function GET(context: APIContext) {
  const { json } = await navFile(context.params.wiki!);
  return new Response(json, { headers: { "content-type": "application/json" } });
}
