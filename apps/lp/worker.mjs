/** LP を配る Worker。www はルートドメインへ 301 で寄せ、それ以外は public/ の静的ファイルを返す。 */
export const ROOT_HOST = "hatchery-works.com";

/** www のホストなら、同じパスとクエリのルートドメインの URL。それ以外は null */
export function redirectTarget(requestUrl) {
  const url = new URL(requestUrl);
  if (url.hostname !== `www.${ROOT_HOST}`) return null;
  url.protocol = "https:";
  url.host = ROOT_HOST;
  return url.toString();
}

export default {
  async fetch(request, env) {
    const target = redirectTarget(request.url);
    if (target) return Response.redirect(target, 301);
    return env.ASSETS.fetch(request);
  },
};
