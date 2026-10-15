/** 台本（Markdown）を、場面と、話す文に分ける。 */

export type Scene = {
  /** 画面に出す見出し */
  heading: string;
  /** 台本の中に書かれた画像（`![](https://…)`）。無ければ null */
  imageUrl: string | null;
  /** 話す文（字幕の単位）。空にならない */
  sentences: string[];
};

/** Markdown の印を落として、話す文字だけにする */
export function stripMarkdown(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<!--.*?-->/g, "")
    .replace(/^\s*(?:>+|[-*+]|\d+[.)])\s+/, "")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .trim();
}

/** 1つの段落を、文末（。！？!?）と改行で文に分ける。文末の記号は残す */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/g) ?? [];
    for (const p of parts) {
      const s = p.trim();
      // 記号だけの断片は、前の文にくっつける
      if (/^[。！？!?]+$/.test(s)) {
        if (out.length > 0) out[out.length - 1] += s;
        continue;
      }
      if (s) out.push(s);
    }
  }
  return out;
}

/**
 * 台本を場面に分ける。見出し（`#`〜`######`）で場面が変わる。見出しより前の文は、`fallbackHeading` の場面になる。
 * 話す文が1つも無い場面は作らない。
 */
export function parseScript(markdown: string, fallbackHeading: string): Scene[] {
  const scenes: Scene[] = [];
  let heading = fallbackHeading;
  let imageUrl: string | null = null;
  let sentences: string[] = [];
  const flush = () => {
    if (sentences.length > 0) scenes.push({ heading, imageUrl, sentences });
    sentences = [];
    imageUrl = null;
  };
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      flush();
      heading = stripMarkdown(h[1] ?? "") || fallbackHeading;
      continue;
    }
    const img = /!\[[^\]]*\]\((https:\/\/[^)\s]+)[^)]*\)/.exec(raw);
    if (img && imageUrl === null) imageUrl = img[1] ?? null;
    const text = stripMarkdown(raw);
    if (text) sentences.push(...splitSentences(text));
  }
  flush();
  return scenes;
}

/** 台本に画像が無い場面へ、渡された画像の URL を順に割り当てる（台本に書かれた画像は、そのまま使う） */
export function assignImages(scenes: Scene[], imageUrls: string[]): Scene[] {
  const used = new Set(scenes.map((s) => s.imageUrl).filter((u): u is string => u !== null));
  const spare = imageUrls.filter((u) => !used.has(u));
  let i = 0;
  return scenes.map((s) => (s.imageUrl !== null ? s : { ...s, imageUrl: spare[i++] ?? null }));
}
