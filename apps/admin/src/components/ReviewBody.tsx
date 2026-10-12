import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { editorExtensions } from "../editor/extensions";
import { editorContentSx } from "../editor/MarkdownEditor";
import { parseBodyWithLines, selectableUnits, targetForLines, type BlockUnit, type LineTarget } from "../lib/blockLines";
import { TOUCH } from "../theme";
import { Tooltip } from "./Tooltip";

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
  /** 印を付けるブロックと出す場所を、行の範囲から決めずに、じかに指す（本文で選んだ範囲に出すとき） */
  target?: LineTarget;
};

/** 本文のブロックを選ぶ操作（編集リクエストを出すとき）。渡すと、選べるブロックに印とボタンが付く。 */
export type ReviewSelect = {
  /** もう選べない行の範囲（いま選んでいる範囲、すでに提案を書いた範囲） */
  excluded: readonly { startLine: number; endLine: number }[];
  /** ブロックを選んだ。`extend` は、いま選んでいる範囲をそこまで広げる操作（Shift を押しながら） */
  onPick: (unit: BlockUnit, extend: boolean) => void;
  /** いまは選べない（理由は、呼ぶ側が画面に出す） */
  disabled?: boolean;
};

/** ブロックの種類の、画面での呼び方 */
const UNIT_NAMES: Record<string, string> = {
  paragraph: "段落",
  heading: "見出し",
  listItem: "リストの項目",
  taskItem: "チェックリストの項目",
  tableRow: "表の行",
  codeBlock: "コードブロック",
  blockquote: "引用",
  details: "トグル",
  table: "表",
  bulletList: "リスト",
  orderedList: "リスト",
  taskList: "チェックリスト",
  horizontalRule: "区切り線",
  image: "画像",
};

const nodeAtPath = (doc: JSONContent, path: readonly number[]) => path.reduce<JSONContent | undefined>((node, i) => node?.content?.[i], doc);
const textOf = (node: JSONContent | undefined): string => (node?.text ?? "") + (node?.content ?? []).map(textOf).join(" ");

/** ブロックの呼び方（「段落」「コールアウト」など）。 */
export function unitName(doc: JSONContent, unit: Pick<BlockUnit, "path">): string {
  const node = nodeAtPath(doc, unit.path);
  if (node?.type === "blockquote" && node.attrs?.callout) return "コールアウト";
  return UNIT_NAMES[node?.type ?? ""] ?? "ブロック";
}

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

function buildDecorations(
  doc: ProseMirrorNode,
  placed: readonly Placed[],
  containerFor: (key: string) => HTMLElement,
  selectable: readonly BlockUnit[],
): DecorationSet {
  const decorations: Decoration[] = [];
  // 選べるブロック。押した場所からブロックを引けるよう、番号を付ける
  selectable.forEach((unit, index) => {
    const block = resolvePath(doc, unit.path);
    if (block) decorations.push(Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "compose-unit", "data-unit": String(index) }));
  });
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
export function ReviewBody(props: {
  bodyMd: string;
  slots: readonly ReviewSlot[];
  /** `parseBodyWithLines(bodyMd)` を呼ぶ側でも使うなら、同じものを渡す（ブロックの場所がそろう） */
  parsed?: ReturnType<typeof parseBodyWithLines>;
  select?: ReviewSelect;
}) {
  const { bodyMd, slots, select } = props;
  const own = useMemo(() => (props.parsed ? null : parseBodyWithLines(bodyMd)), [bodyMd, props.parsed]);
  const parsed = props.parsed ?? own!;
  const excluded = select?.excluded;
  const selectable = useMemo(
    () => (excluded ? selectableUnits(parsed.units).filter((u) => !excluded.some((r) => u.startLine <= r.endLine && r.startLine <= u.endLine)) : []),
    [parsed, excluded],
  );
  const placed = useMemo(() => slots.map((slot): Placed => ({ slot, target: slot.target ?? targetForLines(parsed.units, slot.startLine, slot.endLine) })), [slots, parsed]);

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
  const latest = useRef({ placed, containerFor, selectable });
  latest.current = { placed, containerFor, selectable };

  const editor = useEditor({
    extensions: editorExtensions,
    editable: false,
    content: parsed.doc,
    // 読み取り専用で、描き直しはこちらから頼む。エディタの中の変化で、この部品を描き直さない
    shouldRerenderOnTransaction: false,
    editorProps: {
      decorations: (state) => buildDecorations(state.doc, latest.current.placed, latest.current.containerFor, latest.current.selectable),
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
  }, [editor, placed, selectable]);

  // 選ぶボタンは、本文の右に並べる。ブロックの高さに合わせて置くので、本文の形が変わるたびに測り直す
  const wrapper = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<readonly number[]>([]);
  const selecting = select !== undefined;
  useEffect(() => {
    if (!selecting) return;
    const measure = () => {
      const root = wrapper.current;
      if (!root || editor.isDestroyed) return;
      const base = root.getBoundingClientRect().top;
      const next = latest.current.selectable.map((unit) => {
        const block = resolvePath(editor.state.doc, unit.path);
        const dom = block ? editor.view.nodeDOM(block.pos) : null;
        return dom instanceof HTMLElement ? Math.round(dom.getBoundingClientRect().top - base) : -1;
      });
      setTops((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor.view.dom);
    return () => observer.disconnect();
  }, [editor, selecting, selectable, placed]);

  // ブロックそのものを押しても選べる（ボタンは小さいので、押せる範囲を広げる）
  const pickAt = (event: MouseEvent<HTMLDivElement>) => {
    if (!select || select.disabled) return;
    const target = event.target as HTMLElement;
    // 差し込んだもの（入力欄・提案）の中、リンク、文字を選んでいる途中は、選ぶ操作にしない
    if (target.closest(".review-slot, .compose-handles, a") || !window.getSelection()?.isCollapsed) return;
    const unit = selectable[Number(target.closest<HTMLElement>("[data-unit]")?.dataset.unit ?? -1)];
    if (unit) select.onPick(unit, event.shiftKey);
  };

  const unplaced = placed.filter((p) => p.target.anchor === null);
  return (
    <Box
      ref={wrapper}
      onClick={pickAt}
      sx={(t) => ({
        position: "relative",
        overflowWrap: "anywhere",
        // 選ぶボタンを並べる場所を、本文の右に空ける
        ...(selecting && { pr: 5 }),
        // 選べるブロック。押せることは、右のボタンで示す（ホバーしなくても分かる）。ホバーとフォーカスでは、どこまでが1つかを示す
        "& .compose-unit": { cursor: select?.disabled ? "default" : "pointer", borderRadius: "2px" },
        ...(!select?.disabled && { "@media (hover: hover)": { "& .compose-unit:hover": { bgcolor: "action.hover" } } }),
        "& .tiptap": {
          ...editorContentSx,
          outline: "none",
          // リンクは新しいタブで開く。開く先が別のタブだと分かるよう、印を付ける
          "& a": { color: "primary.main", cursor: "pointer", "&::after": { content: '"↗"', ml: "0.15em", fontSize: "0.75em" } },
          // チェックリストは、押しても変わらない
          "& ul[data-type='taskList'] li > label": { mt: "0.35em", flexShrink: 0, pointerEvents: "none" },
          // 項目（提案・指摘）が指している箇所。背景色だけに頼らず、左に線を引く
          "& .review-target": { position: "relative", bgcolor: "action.hover", borderRadius: "2px" },
          // コールアウトは、::before を種類の名前（「メモ」など）に使っているので、線は枠で引く
          "& blockquote[data-callout].review-target": { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2 },
          "& .review-target:not(blockquote[data-callout], pre, tr)::before": {
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
      {select && (
        <Box className="compose-handles" role="group" aria-label="提案・指摘を書く箇所を選ぶ">
          {selectable.map((unit, i) => {
            const top = tops[i] ?? -1;
            if (top < 0) return null;
            const name = unitName(parsed.doc, unit);
            const excerpt = textOf(nodeAtPath(parsed.doc, unit.path)).trim().slice(0, 20);
            return (
              <Tooltip key={unit.path.join("-")} title={select.disabled ? "" : `この${name}に提案・指摘を書く`} placement="left">
                {/* 押せないボタンにもツールチップの土台が要るので、位置は外側の要素に持たせる */}
                <Box component="span" sx={{ position: "absolute", right: 0, top: top + 1, display: "inline-flex" }}>
                  <IconButton
                    size="small"
                    aria-label={`この${name}に提案・指摘を書く${excerpt ? `：${excerpt}` : ""}`}
                    disabled={select.disabled}
                    onClick={(e) => select.onPick(unit, e.shiftKey)}
                    sx={{
                      width: 26,
                      height: 26,
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                      bgcolor: "background.paper",
                      color: "primary.main",
                      // 1行のブロックが続くので、見た目は小さいまま、押せる範囲だけを左へ広げる（上下に広げると、隣のボタンと重なる）
                      [TOUCH]: { width: 32, "&::after": { content: '""', position: "absolute", inset: "0 0 0 -12px" } },
                    }}
                  >
                    <Pencil size={14} aria-hidden />
                  </IconButton>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      )}
      {placed.filter((p) => p.target.anchor !== null).map((p) => createPortal(p.slot.content, containerFor(p.slot.key), p.slot.key))}
    </Box>
  );
}
