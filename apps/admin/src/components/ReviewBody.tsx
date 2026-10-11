import Box from "@mui/material/Box";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { editorExtensions } from "../editor/extensions";
import { editorContentSx } from "../editor/MarkdownEditor";
import { parseBodyWithLines, targetForLines, type LineTarget } from "../lib/blockLines";

/** 本文の行の範囲に付けて出すもの（編集リクエストの項目など）。 */
export type ReviewSlot = {
  /** 出すものごとに決まった、変わらない名前 */
  key: string;
  /** 本文（Markdown）の行の範囲。1から数え、両端を含む（数え方は `bodyLines`）。`endLine < startLine` なら、その行の直前 */
  startLine: number;
  endLine: number;
  /** 指している箇所に印を付けるか */
  highlight: boolean;
  /** 指している箇所のすぐ下に出すもの */
  content: ReactNode;
};

/** 文書の中の場所（何番目の子かの並び）から、そのブロックと位置を引く。 */
function resolvePath(doc: ProseMirrorNode, path: readonly number[]): { node: ProseMirrorNode; pos: number } | null {
  let parent = doc;
  // 親の中身が始まる位置
  let start = 0;
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  for (const index of path) {
    if (index >= parent.childCount) return null;
    let pos = start;
    for (let i = 0; i < index; i++) pos += parent.child(i).nodeSize;
    found = { node: parent.child(index), pos };
    parent = found.node;
    start = pos + 1;
  }
  return found;
}

type Placed = { slot: ReviewSlot; target: LineTarget };

function buildDecorations(doc: ProseMirrorNode, placed: readonly Placed[], containerFor: (key: string) => HTMLElement): DecorationSet {
  const decorations: Decoration[] = [];
  placed.forEach(({ slot, target }, order) => {
    if (slot.highlight) {
      for (const path of target.blocks) {
        const block = resolvePath(doc, path);
        if (block) decorations.push(Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "review-target" }));
      }
    }
    if (!target.anchor) return;
    const anchor = resolvePath(doc, target.anchor.path);
    // 場所を引けなければ、本文の末尾に出す（出さないよりよい）
    let pos = doc.content.size;
    if (anchor) {
      if (target.anchor.place === "after") pos = anchor.pos + anchor.node.nodeSize;
      else if (target.anchor.place === "inside") pos = anchor.pos + anchor.node.nodeSize - 1;
      else pos = anchor.pos + 1 + (anchor.node.firstChild?.nodeSize ?? 0);
    }
    decorations.push(
      Decoration.widget(pos, () => containerFor(slot.key), {
        key: slot.key,
        // 同じ場所に複数あるときは、渡した順に並べる
        side: 1 + order,
        // 中のボタンは、エディタではなく React が受け持つ
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * 本文を読み取り専用で出し、行の範囲ごとに、指している箇所のすぐ下へ `slots` の中身を差し込む。
 * 本文は、編集画面と同じ拡張と見た目（`editorExtensions` と `editorContentSx`）で出す。
 * 行の範囲からブロックへの対応付けは `lib/blockLines.ts`。
 */
export function ReviewBody({ bodyMd, slots }: { bodyMd: string; slots: readonly ReviewSlot[] }) {
  const parsed = useMemo(() => parseBodyWithLines(bodyMd), [bodyMd]);
  const placed = useMemo(() => slots.map((slot): Placed => ({ slot, target: targetForLines(parsed.units, slot.startLine, slot.endLine) })), [slots, parsed]);

  // 差し込む先の要素。エディタ（ProseMirror）が本文の中に置き、React がその中に描く
  const containers = useRef(new Map<string, HTMLElement>());
  const containerFor = (key: string) => {
    let el = containers.current.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "review-slot";
      el.contentEditable = "false";
      containers.current.set(key, el);
    }
    return el;
  };
  // エディタは、描き直すたびにここから読む
  const latest = useRef({ placed, containerFor });
  latest.current = { placed, containerFor };

  const editor = useEditor({
    extensions: editorExtensions,
    editable: false,
    content: parsed.doc,
    // 読み取り専用で、描き直しはこちらから頼む。エディタの中の変化で、この部品を描き直さない
    shouldRerenderOnTransaction: false,
    editorProps: {
      decorations: (state) => buildDecorations(state.doc, latest.current.placed, latest.current.containerFor),
    },
  });

  // 本文が変わったら（採用で新しい版になったら）差し替える
  const shown = useRef(parsed);
  useEffect(() => {
    if (shown.current === parsed) return;
    shown.current = parsed;
    editor.commands.setContent(parsed.doc, { emitUpdate: false });
  }, [editor, parsed]);
  // 差し込むものが変わったら、エディタに描き直させる
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta("reviewSlots", true));
    const keys = new Set(placed.map((p) => p.slot.key));
    for (const key of containers.current.keys()) if (!keys.has(key)) containers.current.delete(key);
  }, [editor, placed]);

  const unplaced = placed.filter((p) => p.target.anchor === null);
  return (
    <Box
      sx={(t) => ({
        overflowWrap: "anywhere",
        "& .tiptap": {
          ...editorContentSx,
          outline: "none",
          // リンクは新しいタブで開く。開く先が別のタブだと分かるよう、印を付ける
          "& a": { color: "primary.main", cursor: "pointer", "&::after": { content: '"↗"', ml: "0.15em", fontSize: "0.75em" } },
          // チェックリストは、押しても変わらない
          "& ul[data-type='taskList'] li > label": { mt: "0.35em", flexShrink: 0, pointerEvents: "none" },
          // 提案が指している箇所。背景色だけに頼らず、左に線を引く
          "& .review-target": { position: "relative", bgcolor: "action.hover", borderRadius: "2px" },
          "& .review-target::before": {
            content: '""',
            position: "absolute",
            left: -12,
            top: 0,
            bottom: 0,
            width: 3,
            borderRadius: "2px",
            bgcolor: "primary.main",
          },
          // 横に送れるブロック（コードブロック）と表の行は、外に線を出せないので、内側に引く
          "& pre.review-target, & tr.review-target > :first-of-type": { boxShadow: `inset 3px 0 0 ${t.palette.primary.main}` },
          "& pre.review-target::before, & tr.review-target::before": { display: "none" },
          "& tr.review-target > *": { bgcolor: "action.hover" },
          "& .review-slot": { my: 1 },
          // 差し込んだものの中のリンクは、この画面の中の移動。別のタブの印は付けない
          "& .review-slot a::after": { content: "none" },
          // リストの項目の中に出すときは、項目の文字と左端をそろえる
          "& li .review-slot": { my: 0.5 },
        },
      })}
    >
      {unplaced.map((p) => (
        <Box key={p.slot.key} sx={{ my: 1 }}>
          {p.slot.content}
        </Box>
      ))}
      <EditorContent editor={editor} />
      {placed.filter((p) => p.target.anchor !== null).map((p) => createPortal(p.slot.content, containerFor(p.slot.key), p.slot.key))}
    </Box>
  );
}
