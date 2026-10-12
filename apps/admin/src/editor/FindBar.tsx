import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { TOUCH } from "../theme";
import { clampFindBarOffset, FIND_BAR_TOP, type Offset } from "./findBarPosition";
import { isFindBarOpen, setFindBarOpen, subscribeFindBar } from "./findBarState";
import { Tooltip } from "../components/Tooltip";
import { Muted } from "../components/ui";
import { createFindPlugin, findKey, replaceAll, replaceCurrent, selectCurrent, setQuery, step } from "./findPlugin";

const KEY_STEP = 16;
const NO_OFFSET: Offset = { x: 0, y: 0 };

// 狭い幅（sm 未満）では、入力欄だけで 1 段使う（ボタンは次の段へ回す）。
// 指で操作する端末では、iOS の Safari が入力欄にフォーカスしたときに画面を拡大しないよう、文字を 16px にする
const inputSx = {
  flex: 1,
  minWidth: 0,
  px: 1,
  height: 30,
  fontSize: "0.9rem",
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  flexBasis: { xs: "100%", sm: 0 },
  [TOUCH]: { fontSize: 16, height: 40 },
} as const;
// 前の一致・次の一致・閉じる。指で操作する端末では 40px にする
const barButtonSx = { [TOUCH]: { width: 40, height: 40, "&::after": { display: "none" } } } as const;

/**
 * 検索バーを動かせる範囲。`data-find-bar-bounds` をつけた祖先（本文の列）のうち、画面に見えている部分。
 * 列の外（右の「公開・履歴」パネルなど）には、下に潜って掴めなくなるので出さない。
 */
function boundsOf(el: Element | null) {
  const column = el?.closest("[data-find-bar-bounds]")?.getBoundingClientRect();
  return {
    left: Math.max(0, column?.left ?? 0),
    top: 0,
    right: Math.min(window.innerWidth, column?.right ?? window.innerWidth),
    bottom: window.innerHeight,
  };
}

/**
 * 本文の検索と置換。⌘F（Ctrl+F）か、ヘッダーの虫めがねボタンで開く。
 * 開いている間にもう一度 ⌘F を押すと、ブラウザ標準の検索に譲る。
 * 左端のつまみをドラッグするか、つまみにフォーカスして矢印キーで動かせる。ダブルクリックで元の位置に戻す。
 */
export function FindBar({ editor }: { editor: Editor }) {
  const open = useSyncExternalStore(subscribeFindBar, isFindBarOpen);
  const [query, setQueryText] = useState("");
  const [replacement, setReplacement] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  // 元の位置（本文の右上）からどれだけ動かしたか。閉じて開き直しても保つ
  const [offset, setOffset] = useState(NO_OFFSET);
  const paperRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; startOffset: Offset; startRect: DOMRect } | null>(null);
  const [dragging, setDragging] = useState(false);
  const found = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = findKey.getState(e.state);
      return { count: s?.matches.length ?? 0, index: s?.index ?? 0 };
    },
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      // すでに検索欄にいるときは、ブラウザ標準の検索を出させる
      if (open && document.activeElement === queryRef.current) return;
      e.preventDefault();
      setFindBarOpen(true);
      queryRef.current?.focus();
      queryRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 別のページへ移ったら閉じる
  useEffect(() => () => setFindBarOpen(false), []);

  // 開いている間だけ、一致した箇所に印をつけるプラグインを足す
  useEffect(() => {
    if (!open) return;
    editor.registerPlugin(createFindPlugin());
    return () => void editor.unregisterPlugin(findKey);
  }, [editor, open]);

  useEffect(() => {
    if (!open) return;
    editor.view.dispatch(setQuery(editor.state.tr, query));
  }, [editor, open, query]);

  // いまの一致が画面の外にあれば、見える位置までスクロールする
  useEffect(() => {
    if (open) editor.view.dom.querySelector(".find-current")?.scrollIntoView({ block: "center" });
  }, [editor, open, found.index, found.count, query]);

  // 窓や列の大きさが変わったりスクロールしたりしても、動かせる範囲の外に取り残さない
  useEffect(() => {
    if (!open) return;
    const keepInside = () => {
      const rect = paperRef.current?.getBoundingClientRect();
      if (!rect) return;
      setOffset((prev) => {
        const next = clampFindBarOffset(prev, rect, boundsOf(paperRef.current));
        return next.x === prev.x && next.y === prev.y ? prev : next;
      });
    };
    window.addEventListener("resize", keepInside);
    window.addEventListener("scroll", keepInside, { capture: true, passive: true });
    // 右のパネルを開け閉めすると、窓はそのままで列の幅だけが変わる
    const column = paperRef.current?.closest("[data-find-bar-bounds]");
    const observer = new ResizeObserver(keepInside);
    if (column) observer.observe(column);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepInside);
      window.removeEventListener("scroll", keepInside, { capture: true });
    };
  }, [open]);

  if (!open) return null;

  // 元の位置から (dx, dy) だけ動かす。画面の外には出さない
  const moveBy = (from: Offset, fromRect: DOMRect, dx: number, dy: number) => {
    const rect = { left: fromRect.left + dx, top: fromRect.top + dy, right: fromRect.right + dx, bottom: fromRect.bottom + dy };
    setOffset(clampFindBarOffset({ x: from.x + dx, y: from.y + dy }, rect, boundsOf(paperRef.current)));
  };

  const run = (tr: ReturnType<typeof step>) => tr && editor.view.dispatch(tr);
  const close = () => {
    // 見ていた一致を選択した状態で、エディタに戻る
    run(selectCurrent(editor.state));
    setFindBarOpen(false);
    editor.commands.focus();
  };
  const onKeyDown = (e: KeyboardEvent, onEnter: () => void) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  };

  return (
    // 高さを持たせず、本文の右上に重ねて出す（開いても本文が下にずれないように）
    <Box sx={{ position: "sticky", top: FIND_BAR_TOP, zIndex: 2, height: 0, display: "flex", justifyContent: "flex-end" }}>
      <Paper
        ref={paperRef}
        elevation={dragging ? 8 : 4}
        role="search"
        aria-label="本文の検索と置換"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        sx={{ width: { xs: "100%", sm: 400 }, maxWidth: "100%", height: "fit-content", p: 1, pl: 0, display: "flex" }}
      >
        <Tooltip title="ドラッグで移動（ダブルクリックで元の位置に戻す）">
          <Box
            role="button"
            tabIndex={0}
            aria-label="検索バーを移動"
            onPointerDown={(e) => {
              if (!paperRef.current) return;
              // 検索欄のフォーカスを奪わない
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { startX: e.clientX, startY: e.clientY, startOffset: offset, startRect: paperRef.current.getBoundingClientRect() };
              setDragging(true);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) moveBy(d.startOffset, d.startRect, e.clientX - d.startX, e.clientY - d.startY);
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
            onDoubleClick={() => setOffset(NO_OFFSET)}
            onKeyDown={(e) => {
              const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const)[e.key];
              if (!dir || !paperRef.current) return;
              e.preventDefault();
              moveBy(offset, paperRef.current.getBoundingClientRect(), dir[0] * KEY_STEP, dir[1] * KEY_STEP);
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              px: 0.25,
              mr: 0.25,
              color: "text.secondary",
              cursor: dragging ? "grabbing" : "grab",
              touchAction: "none",
              borderRadius: 1,
              "&:hover, &:focus-visible": { color: "text.primary", bgcolor: "action.hover" },
              "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
            }}
          >
            <GripVertical size={18} />
          </Box>
        </Tooltip>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexWrap: { xs: "wrap", sm: "nowrap" } }}>
            <InputBase
              autoFocus
              inputRef={queryRef}
              value={query}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, () => run(step(editor.state, e.shiftKey ? -1 : 1)))}
              placeholder="本文を検索"
              inputProps={{ "aria-label": "検索する文字" }}
              sx={inputSx}
            />
            <Muted aria-live="polite" sx={{ minWidth: 64, flex: { xs: 1, sm: "none" }, textAlign: { xs: "left", sm: "center" }, pl: { xs: 0.5, sm: 0 }, fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
              {query === "" ? "" : found.count === 0 ? "一致なし" : `${found.index + 1} / ${found.count}`}
            </Muted>
            <Tooltip title="前の一致 (Shift+Enter)">
              <span>
                <IconButton size="small" aria-label="前の一致" disabled={found.count === 0} sx={barButtonSx} onClick={() => run(step(editor.state, -1))}>
                  <ChevronUp size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="次の一致 (Enter)">
              <span>
                <IconButton size="small" aria-label="次の一致" disabled={found.count === 0} sx={barButtonSx} onClick={() => run(step(editor.state, 1))}>
                  <ChevronDown size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="検索を閉じる (Esc)">
              <IconButton size="small" aria-label="検索を閉じる" onClick={close} sx={{ ml: 0.5, ...barButtonSx }}>
                <X size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexWrap: { xs: "wrap", sm: "nowrap" } }}>
            <InputBase
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, () => run(replaceCurrent(editor.state, replacement)))}
              placeholder="置き換える文字"
              inputProps={{ "aria-label": "置き換える文字" }}
              sx={inputSx}
            />
            <Button variant="outlined" sx={{ whiteSpace: "nowrap", [TOUCH]: { minHeight: 40 } }} disabled={found.count === 0} onClick={() => run(replaceCurrent(editor.state, replacement))}>
              置換
            </Button>
            <Button variant="outlined" sx={{ whiteSpace: "nowrap", [TOUCH]: { minHeight: 40 } }} disabled={found.count === 0} onClick={() => run(replaceAll(editor.state, replacement))}>
              すべて置換
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
