import type { APIContext } from "astro";
import { allWikis, fullNav, siteData } from "../../lib/manifest";
import type { NavData } from "../../lib/nav";

export async function getStaticPaths() {
  return (await allWikis()).map((w) => ({ params: { wiki: w.key } }));
}

/**
 * ツリーナビの全体（wiki ごとに1つ）。記事のページの HTML には最初の表示の分だけを入れ、残りはツリーナビがここから読む。
 * 入るのは、その wiki の公開ツリー（公開ページだけ。マニフェストの `trees`）。限定公開・非公開のページは、題名も id も入らない。
 */
export async function GET(context: APIContext) {
  const { wiki } = await siteData(context.params.wiki!);
  const data: NavData = { trees: {} };
  for (const tree of wiki.trees) data.trees[tree.key] = await fullNav(wiki.key, tree);
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}
