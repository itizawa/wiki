/** タイトルの1文字目（サロゲートペアや結合した絵文字を壊さない）。空白だけ・空なら null。 */
export function firstChar(title: string): string | null {
  const t = title.trim();
  if (t === "") return null;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    for (const s of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)) return s.segment;
  }
  return Array.from(t)[0] ?? null;
}

/** タイトルから決める色相（0〜359）。同じタイトルは、いつも同じ色になる。 */
export function titleHue(title: string): number {
  let h = 0;
  for (const c of title) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * ページごとのファビコン（SVG の data URI）。
 * 絵文字があれば、背景なしでその絵文字だけを大きく描く。無ければ、タイトルの1文字目を、タイトルから決めた色の角丸の四角に白で描く。
 * タイトルが空で絵文字も無ければ null（既定のファビコンのままにする）。
 */
export function pageFaviconHref(title: string, icon: string | null | undefined): string | null {
  let svg: string;
  if (icon) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="16" font-size="28" text-anchor="middle" dominant-baseline="central">${escapeXml(icon)}</text></svg>`;
  } else {
    const ch = firstChar(title);
    if (ch === null) return null;
    const hue = titleHue(title.trim());
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="hsl(${hue} 55% 42%)"/>` +
      `<text x="16" y="16.5" font-size="20" font-weight="700" font-family="system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif" text-anchor="middle" dominant-baseline="central" fill="#fff">${escapeXml(ch.toUpperCase())}</text></svg>`;
  }
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
