/**
 * 管理画面の検索の書き方。
 *
 * - 空白で区切った語は、すべて含むもの（AND）
 * - `"二つの 語"` は、空白ごとひと続きで含むもの
 * - `-語` は、その語を含まないもの
 * - `A OR B` は、どちらかを含むもの（OR は大文字で、前後を空白で区切る）
 *
 * 大文字と小文字は区別しない。語は単語の区切りを見ない部分一致（日本語は分かち書きしないため）。
 */
export type SearchGroup = { all: string[]; none: string[] };

/** 検索の文字列を、「どれか1つを満たせばよい」グループの並びに分ける。条件が無ければ空の配列。 */
export function parseSearchQuery(input: string): SearchGroup[] {
  const groups: SearchGroup[] = [];
  let current: SearchGroup = { all: [], none: [] };
  const close = () => {
    if (current.all.length > 0 || current.none.length > 0) groups.push(current);
    current = { all: [], none: [] };
  };
  for (const [token] of input.matchAll(/-?"[^"]*"?|\S+/g)) {
    if (token === "OR") {
      close();
      continue;
    }
    const exclude = token.startsWith("-") && token.length > 1;
    const term = (exclude ? token.slice(1) : token).replace(/^"|"$/g, "").trim();
    if (term === "") continue;
    (exclude ? current.none : current.all).push(term);
  }
  close();
  return groups;
}

/** 探している語（除外の語は含まない）。一致した場所を示すのに使う。 */
export const searchTerms = (groups: SearchGroup[]): string[] => [...new Set(groups.flatMap((g) => g.all))];

const includes = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());

/** 文字列が、グループのどれか1つを満たすか。 */
export function matchesSearch(text: string, groups: SearchGroup[]): boolean {
  return groups.some((g) => g.all.every((t) => includes(text, t)) && g.none.every((t) => !includes(text, t)));
}

/** 本文（Markdown）から、記法の記号を落とした文字だけを取り出す（検索結果に出す用）。 */
function plain(md: string): string {
  return md
    .replace(/^```.*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 本文の中で、最初に語が出てくるあたりを切り出す（前後 `radius` 文字）。途中から・途中までのときは「…」を付ける。
 * どの語も出てこなければ null。
 */
export function searchSnippet(bodyMd: string, terms: string[], radius = 40): string | null {
  const text = plain(bodyMd);
  const lower = text.toLowerCase();
  let at = -1;
  let length = 0;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      length = term.length;
    }
  }
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** 文字列を、語に一致した部分とそれ以外に分ける（一致した部分を目立たせて出すため）。 */
export function splitByTerms(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const escaped = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return text ? [{ text, hit: false }] : [];
  // 長い語を先に試す（「公開」と「公開範囲」があれば、長いほうで一致させる）
  const pattern = new RegExp(`(${escaped.sort((a, b) => b.length - a.length).join("|")})`, "gi");
  // 区切りを括弧で囲んでいるので、奇数番目が一致した部分になる
  return text
    .split(pattern)
    .map((part, i) => ({ text: part, hit: i % 2 === 1 }))
    .filter((part) => part.text !== "");
}

/** 検索結果の1件。 */
export type SearchResult = {
  id: string;
  title: string;
  visibility: "public" | "unlisted" | "private";
  updatedAt: string;
  /** 本文の、語が出てくるあたり。タイトルだけに一致したとき・検索の語が無いときは null */
  snippet: string | null;
};
