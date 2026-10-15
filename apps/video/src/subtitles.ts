/**
 * 台本の各文が話された時刻を、書き起こし（単語ごとの時刻つき）に合わせて出す。
 * 書き起こしは、言い間違い・言い換え・聞き間違いで台本と少し違うので、文字ごとの最長共通部分列で対応づける。
 */

export type Word = { text: string; start: number; end: number };
export type Timing = { start: number; end: number };
export type Cue = { text: string; start: number; end: number };

/** 比べるための正規化：全角半角をそろえ、文字と数字以外（記号・空白）を落とす */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** 比べる表の大きさの上限。超えるときは、文字数に比例して割り振る */
const MAX_CELLS = 60_000_000;
/** 文のうち、書き起こしと合った文字がこの割合に満たなければ、その文は合わなかったものとして補う */
const MIN_MATCH_RATIO = 0.3;

type Char = { ch: string; t0: number; t1: number };

function transcriptChars(words: Word[]): Char[] {
  const out: Char[] = [];
  for (const w of words) {
    const chars = [...normalize(w.text)];
    const span = Math.max(0, w.end - w.start);
    chars.forEach((ch, i) => out.push({ ch, t0: w.start + (span * i) / chars.length, t1: w.start + (span * (i + 1)) / chars.length }));
  }
  return out;
}

/** 最長共通部分列の組（台本の何文字目、書き起こしの何文字目）を、前から順に返す */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // 長さは Uint16 に収まる（表の大きさの上限から、片方が 65,535 を超えることは無い）
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * 文ごとの開始と終了（秒）を返す。返す配列は `sentences` と同じ長さで、時刻は前から順で、重ならず、`totalSec` を超えない。
 * 書き起こしと合わなかった文は、前後の合った文のあいだに、文字数に比例して割り振る。
 */
export function alignSentences(sentences: string[], words: Word[], totalSec: number): Timing[] {
  const sentChars: string[] = [];
  const owner: number[] = [];
  sentences.forEach((s, k) => {
    for (const ch of normalize(s)) {
      sentChars.push(ch);
      owner.push(k);
    }
  });
  const tChars = transcriptChars(words);

  const known: Array<Timing | null> = sentences.map(() => null);
  if (sentChars.length > 0 && tChars.length > 0 && sentChars.length * tChars.length <= MAX_CELLS && Math.min(sentChars.length, tChars.length) < 65_535) {
    const pairs = lcsPairs(
      sentChars,
      tChars.map((c) => c.ch),
    );
    const per = sentences.map(() => ({ matched: 0, total: 0, start: Infinity, end: -Infinity }));
    for (const k of owner) per[k]!.total++;
    for (const [i, j] of pairs) {
      const p = per[owner[i]!]!;
      p.matched++;
      p.start = Math.min(p.start, tChars[j]!.t0);
      p.end = Math.max(p.end, tChars[j]!.t1);
    }
    per.forEach((p, k) => {
      if (p.total > 0 && p.matched / p.total >= MIN_MATCH_RATIO) known[k] = { start: p.start, end: p.end };
    });
  }
  return fillGaps(sentences, known, totalSec);
}

/** 合わなかった文を、前後の合った文のあいだに文字数で割り振り、時刻を前から順に整える */
function fillGaps(sentences: string[], known: Array<Timing | null>, totalSec: number): Timing[] {
  const weight = sentences.map((s) => Math.max(1, normalize(s).length));
  const out: Timing[] = [];
  let k = 0;
  let cursor = 0;
  while (k < sentences.length) {
    const t = known[k];
    if (t) {
      out.push({ start: t.start, end: t.end });
      cursor = t.end;
      k++;
      continue;
    }
    let e = k;
    while (e < sentences.length && !known[e]) e++;
    const until = e < sentences.length ? known[e]!.start : totalSec;
    const sum = weight.slice(k, e).reduce((a, b) => a + b, 0);
    const span = Math.max(0, until - cursor);
    let at = cursor;
    for (let q = k; q < e; q++) {
      const len = (span * weight[q]!) / sum;
      out.push({ start: at, end: at + len });
      at += len;
    }
    cursor = until;
    k = e;
  }
  // 前から順に、重ならないようにし、全体の長さに収める
  let prevEnd = 0;
  return out.map((t) => {
    const start = Math.min(Math.max(t.start, prevEnd), totalSec);
    const end = Math.min(Math.max(t.end, start), totalSec);
    prevEnd = end;
    return { start, end };
  });
}

/** 長い文を、読点か文字数で区切った字幕に分ける。時刻は文字数に比例して割り振る */
export function splitLongCue(cue: Cue, maxChars = 36): Cue[] {
  if ([...cue.text].length <= maxChars) return [cue];
  const pieces: string[] = [];
  let cur = "";
  for (const part of cue.text.split(/(?<=[、，,])/)) {
    if ([...cur].length + [...part].length > maxChars && cur) {
      pieces.push(cur);
      cur = "";
    }
    cur += part;
    while ([...cur].length > maxChars) {
      pieces.push([...cur].slice(0, maxChars).join(""));
      cur = [...cur].slice(maxChars).join("");
    }
  }
  if (cur) pieces.push(cur);
  const total = pieces.reduce((a, p) => a + [...p].length, 0);
  const span = cue.end - cue.start;
  let at = cue.start;
  return pieces.map((p) => {
    const len = (span * [...p].length) / total;
    const c = { text: p, start: at, end: at + len };
    at += len;
    return c;
  });
}

/** 画面で折り返すために、字幕の1行の長さを決めて改行を入れる */
export function wrapLines(text: string, perLine = 22): string {
  const chars = [...text];
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(""));
  return lines.join("\n");
}

export function srtTime(sec: number): string {
  const ms = Math.round(Math.max(0, sec) * 1000);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000), 2)}:${p(Math.floor(ms / 60_000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrapLines(c.text.replace(/[。！？!?]+$/, ""))}\n`).join("\n");
}
