/**
 * wiki のアイコン（頭文字の四角）に使う色の並び。
 * 上に白い頭文字を載せるので、白とのコントラスト比が 4.5:1 以上の色だけを置く（テストで確かめている）。
 * ライトとダークで同じ色を使う。どちらの背景からも四角が見分けられる明るさにしてある。
 */
export const WIKI_COLORS = ["#2f6fde", "#7c4ddb", "#c2378a", "#c93636", "#b45309", "#17803d", "#0e7c86", "#64748b"] as const;

/** wiki の色。key から決めるので、同じ wiki はどこでもいつでも同じ色になる（DB には持たない）。 */
export function wikiColor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return WIKI_COLORS[hash % WIKI_COLORS.length]!;
}
