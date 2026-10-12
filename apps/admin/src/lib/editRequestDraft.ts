import { locateLineEdit, type CreateEditRequestInput, type StaleReason } from "@wiki/shared";
import type { BuiltSuggestion } from "./blockEdit";
import { parseBodyWithLines, selectionForLines, type BlockUnit, type UnitSelection } from "./blockLines";

/**
 * 編集リクエストを画面から出すときの、**送信前の項目**（まだサーバーに送っていない。画面を離れると消える）。
 *
 * 項目は種類（`kind`）で分ける：提案（置き換え案を持つ）と、指摘（置き換え案を持たず、本文を持つ）。
 * 種類ごとに違うのは、`toCreateInput` と、入力欄（`components/compose/ItemComposer.tsx`）・表示（`DraftItemCard.tsx`）。
 * 版が進んだときの付け替え（`rebaseDraftItems`）は、どちらも同じ（選んだ範囲の元の文面で探し直す）。
 */

/** どの種類の項目も持つもの */
type DraftBase = {
  /** 画面の中だけの ID */
  id: string;
  /** 本文で選んだ範囲（基準の版での行）と、その文面。本文が新しい版になったら、この文面で場所を探し直す */
  selection: Pick<UnitSelection, "kind" | "startLine" | "endLine">;
  selectedText: string;
  /** 本文が新しい版になって、場所を決められなくなった理由。場所があるあいだは null */
  lost: StaleReason | null;
};

/** 提案：選んだ範囲のうち、変わった行を、置き換え案で置き換える */
export type DraftSuggestion = DraftBase &
  BuiltSuggestion & {
    kind: "suggestion";
    /** 小さなエディタの中身（Markdown）。「直す」で入れ直す */
    editorMarkdown: string;
    /** 理由（任意） */
    reason: string;
  };

/** 指摘：選んだ範囲に、本文（プレーンテキスト）を付ける。行の範囲は、選んだ範囲そのまま */
export type DraftNote = DraftBase & {
  kind: "note";
  startLine: number;
  endLine: number;
  /** 選んだ範囲の文面（`selectedText` と同じ） */
  originalText: string;
  /** 指摘の本文（必須） */
  body: string;
};

export type DraftItem = DraftSuggestion | DraftNote;

type Range = { startLine: number; endLine: number };
export const rangesOverlap = (a: Range, b: Range) => a.startLine <= b.endLine && b.startLine <= a.endLine;

/** 本文の上から順（送る順と、画面に並べる順） */
export const inBodyOrder = <T extends { selection: Range }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.selection.startLine - b.selection.startLine);

/** 選んだ範囲を、新しい本文で探し直す。見つかれば、何行ずれたかと、選び直した範囲 */
export function relocateSelection(
  units: readonly BlockUnit[],
  body: string,
  selection: DraftBase["selection"],
  selectedText: string,
): { ok: true; selection: UnitSelection; shift: number } | { ok: false; reason: StaleReason } {
  const found = locateLineEdit(body, { ...selection, originalText: selectedText, atBase: false });
  if (!found.ok) return found;
  // 同じ文面が見つかっても、まわりが変わって、同じ階層のブロックのまとまりでなくなっていることがある
  const again = selectionForLines(units, selection.kind, found.startLine, found.endLine);
  if (!again) return { ok: false, reason: "not_found" };
  return { ok: true, selection: again, shift: found.startLine - selection.startLine };
}

/**
 * 本文が新しい版になったとき、送信前の項目を新しい本文に合わせる。
 * 選んだ範囲の元の文面を探し直し（`locateLineEdit`）、1か所だけ見つかれば、行をずらして残す。
 * 見つからない・複数ある項目は、理由（`lost`）を付けて残す（送れない。書いた内容は見せ続ける）。
 */
export function rebaseDraftItems(items: readonly DraftItem[], body: string): DraftItem[] {
  const { units } = parseBodyWithLines(body);
  return items.map((item): DraftItem => {
    const at = relocateSelection(units, body, item.selection, item.selectedText);
    if (!at.ok) return { ...item, lost: at.reason };
    const { kind, startLine, endLine } = at.selection;
    return { ...item, lost: null, selection: { kind, startLine, endLine }, startLine: item.startLine + at.shift, endLine: item.endLine + at.shift };
  });
}

/** 送信する内容（`POST edit-requests`）。場所を決められなくなった項目は入れない。 */
export function toCreateInput(baseVersionId: string, comment: string, items: readonly DraftItem[]): CreateEditRequestInput {
  return {
    baseVersionId,
    comment: comment.trim() || undefined,
    items: inBodyOrder(items.filter((i) => i.lost === null)).map((i) =>
      i.kind === "note"
        ? { kind: "note", startLine: i.startLine, endLine: i.endLine, body: i.body.trim() }
        : { kind: "suggestion", startLine: i.startLine, endLine: i.endLine, replacement: i.replacement, reason: i.reason.trim() || undefined },
    ),
  };
}
