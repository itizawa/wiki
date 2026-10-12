import { parseGoogleMapUrl } from "./googleMap";

/**
 * 本文に貼った URL をカード（OGP）で出す。書き方は、段落に「URL だけ」を置く（専用の記法は足さない）。
 *
 * ```md
 * https://example.com/article
 * ```
 *
 * カードにするかどうかは、表示するときに決める。文章の中のリンク、`[文字](URL)`、URL のあとに文字が続く行は、これまでどおりリンク。
 * Google マップの URL は地図になるので、カードにしない（googleMap.ts）。
 * 自分の wiki のページへのリンク（内部リンク）の扱いは、表示する側が決める（外部のものだけをカードにする）。
 */

/** API が返す・公開時に保存する、1つの URL の OGP。`GET /link-preview` と、公開サイトのカードが使う。 */
export type LinkPreview = {
  title: string;
  description: string | null;
  /** `<img>` にそのまま使える https の URL。無ければ null（画像のファイルそのものは保存しない） */
  imageUrl: string | null;
  siteName: string | null;
};

/** 公開サイトのカードに必要な項目だけ（画像は、読者のブラウザが外部へ読みに行かないよう、公開サイトでは出さない）。 */
export type LinkCardData = Pick<LinkPreview, "title" | "description" | "siteName">;

/** 1つの URL の文字が、カードにできる形（http・https の URL。ユーザー名・パスワード入りは除く）なら、URL の文字を返す。 */
function parseHttpUrl(text: string): string | null {
  let s = text.trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return s;
  } catch {
    return null;
  }
}

/** 段落の文字が「URL だけ」なら、その URL を返す。Google マップの URL と、URL 以外が混ざった段落は null。 */
export function linkCardOfParagraph(text: string): { url: string } | null {
  const url = parseHttpUrl(text);
  if (!url || parseGoogleMapUrl(url)) return null;
  return { url };
}

/**
 * 本文のうち、カードにできる段落の URL（出てきた順、重複なし）。コードブロックの中は読まない。
 * 公開のとき、これらの OGP を取って保存する。
 */
export function linkCardUrls(md: string): string[] {
  const urls: string[] = [];
  let fence: string | null = null;
  let block: string[] = [];
  const flush = () => {
    const card = block.length === 1 ? linkCardOfParagraph(block[0]!) : null;
    if (card && !urls.includes(card.url)) urls.push(card.url);
    block = [];
  };
  for (const line of md.split("\n")) {
    const f = /^[ \t]*(```+|~~~+)/.exec(line);
    if (fence) {
      if (f && f[1]!.startsWith(fence[0]!) && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      flush();
      fence = f[1]!;
      continue;
    }
    if (line.trim() === "") flush();
    else block.push(line);
  }
  flush();
  return urls;
}

/** ページへのリンク `/p/{id}`（相対、または `isOwnOrigin` が認めるオリジンの絶対 URL）なら、そのページの id。 */
export function pageIdOfHref(href: string, isOwnOrigin: (origin: string) => boolean = () => false): string | null {
  const m = /^(https?:\/\/[^/?#]+)?\/p\/([0-9a-z]{10})(?:[-/?#]|$)/.exec(href.trim());
  if (!m) return null;
  if (m[1] && !isOwnOrigin(m[1].toLowerCase())) return null;
  return m[2]!;
}
