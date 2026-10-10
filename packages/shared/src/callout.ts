/**
 * コールアウト（目立たせたい注意書き）。Markdown では GitHub と同じ書き方で保存する：
 *
 *     > [!NOTE]
 *     > 本文
 */
export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

/** 画面に出す名前。色だけに頼らず、必ずこの名前を添える。 */
export const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "メモ",
  tip: "ヒント",
  important: "重要",
  warning: "注意",
  caution: "警告",
};

const MARKER = /^\[!([A-Za-z]+)\][ \t]*(?:\n|$)/;

/**
 * 引用の先頭の段落から、コールアウトの印（`[!NOTE]` の行）を読み取る。
 * 印があれば、種類と、印を取り除いた残りの文字を返す。無ければ null。
 */
export function parseCalloutMarker(text: string): { type: CalloutType; rest: string } | null {
  const m = MARKER.exec(text);
  if (!m) return null;
  const type = m[1]!.toLowerCase();
  if (!(CALLOUT_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as CalloutType, rest: text.slice(m[0].length) };
}

/** Markdown に書き出すときの印。 */
export const calloutMarker = (type: CalloutType) => `[!${type.toUpperCase()}]`;
