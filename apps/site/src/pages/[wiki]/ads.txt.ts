import type { APIContext } from "astro";
import { adsTxt } from "../../lib/adsense";
import { allWikis } from "../../lib/manifest";

/** AdSense のパブリッシャー ID がある wiki だけに出す。無い wiki の `/ads.txt` は 404 になる */
export async function getStaticPaths() {
  return (await allWikis()).flatMap((w) => {
    const body = adsTxt(w);
    return body ? [{ params: { wiki: w.key }, props: { body } }] : [];
  });
}

export function GET(context: APIContext<{ body: string }>) {
  return new Response(context.props.body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
