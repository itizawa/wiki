import { bodyLines, replacementLines } from "@wiki/shared";
import { diffArrays, diffWords } from "diff";

/**
 * 編集リクエストの項目の差分：元の文面と置き換え案を、Markdown の行の - / + で並べる。
 * 行の中は、変わった語に印（`changed`）を付ける。画面は、背景色に加えて打消し線・下線でも示す（色だけに頼らない）。
 */

/** 行の中のひと続きの文字。changed なら、相手の行と違う部分 */
export type DiffSegment = { text: string; changed: boolean };

export type DiffLine = {
  /** removed: 消える行（-）/ added: 入る行（+）/ same: 変わらない行 */
  kind: "removed" | "added" | "same";
  segments: DiffSegment[];
};

// 日本語は空白で語が分かれないので、語の区切りは Intl.Segmenter に任せる（無い環境では、空白で分ける）
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "word" }) : undefined;

const whole = (text: string): DiffSegment[] => (text === "" ? [] : [{ text, changed: false }]);

/** 対になる2行（消える行と入る行）の、変わった語。 */
function wordSegments(before: string, after: string): { removed: DiffSegment[]; added: DiffSegment[] } {
  const parts = diffWords(before, after, segmenter ? { intlSegmenter: segmenter } : {});
  const removed: DiffSegment[] = [];
  const added: DiffSegment[] = [];
  const push = (list: DiffSegment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const part of parts) {
    if (!part.added) push(removed, part.value, Boolean(part.removed));
    if (!part.removed) push(added, part.value, Boolean(part.added));
  }
  // 共通する語が1つも無い行は、行ごと入れ替わっている。行の印（- / +）で足りるので、語には印を付けない
  const nothingShared = parts.every((p) => p.added || p.removed || p.value.trim() === "");
  return nothingShared ? { removed: whole(before), added: whole(after) } : { removed, added };
}

/**
 * 元の文面と置き換え案の差分。行は `bodyLines` と同じ数え方（置き換え案が空の文字なら、行を消す提案）。
 * 消える行のかたまりのすぐあとに入る行のかたまりが続くところは、上から順に1行ずつ対にして、行の中の変わった語を出す。
 */
export function suggestionDiff(originalText: string, replacement: string): DiffLine[] {
  const parts = diffArrays(bodyLines(originalText), replacementLines(replacement));
  const lines: DiffLine[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const next = parts[i + 1];
    if (part.removed && next?.added) {
      const pairs = part.value.map((before, k) => (k < next.value.length ? wordSegments(before, next.value[k]!) : null));
      part.value.forEach((before, k) => lines.push({ kind: "removed", segments: pairs[k]?.removed ?? whole(before) }));
      next.value.forEach((after, k) => lines.push({ kind: "added", segments: pairs[k]?.added ?? whole(after) }));
      i++;
    } else {
      const kind = part.removed ? "removed" : part.added ? "added" : "same";
      for (const text of part.value) lines.push({ kind, segments: whole(text) });
    }
  }
  return lines;
}
