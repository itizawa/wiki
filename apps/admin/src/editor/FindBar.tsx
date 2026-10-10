import { ChevronDown, ChevronUp, X } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Tooltip } from "../components/Tooltip";
import { Muted } from "../components/ui";
import { createFindPlugin, findKey, replaceAll, replaceCurrent, selectCurrent, setQuery, step } from "./findPlugin";

const inputSx = { flex: 1, minWidth: 0, px: 1, height: 30, fontSize: "0.9rem", borderRadius: 1, border: 1, borderColor: "divider" } as const;

// 開いているかどうか。ヘッダーのボタン（エディタの外）からも開けるよう、部品の外に持つ
const listeners = new Set<() => void>();
let isOpen = false;
const onOpenChange = (next: boolean) => {
  isOpen = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** 検索バーを開く（すでに開いていれば、検索欄にフォーカスを戻す）。 */
export function openFindBar() {
  onOpenChange(true);
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[role="search"] input')?.focus());
}

/**
 * 本文の検索と置換。⌘F（Ctrl+F）か、ヘッダーの虫めがねボタンで開く。
 * 開いている間にもう一度 ⌘F を押すと、ブラウザ標準の検索に譲る。
 */
export function FindBar({ editor }: { editor: Editor }) {
  const open = useSyncExternalStore(subscribe, () => isOpen);
  const [query, setQueryText] = useState("");
  const [replacement, setReplacement] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
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
      onOpenChange(true);
      queryRef.current?.focus();
      queryRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 別のページへ移ったら閉じる
  useEffect(() => () => onOpenChange(false), []);

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

  if (!open) return null;

  const run = (tr: ReturnType<typeof step>) => tr && editor.view.dispatch(tr);
  const close = () => {
    // 見ていた一致を選択した状態で、エディタに戻る
    run(selectCurrent(editor.state));
    onOpenChange(false);
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
    <Box sx={{ position: "sticky", top: 56, zIndex: 2, height: 0, display: "flex", justifyContent: "flex-end" }}>
      <Paper elevation={4} role="search" aria-label="本文の検索と置換" sx={{ width: 380, maxWidth: "100%", height: "fit-content", p: 1 }}>
        <Stack spacing={0.75}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
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
            <Muted aria-live="polite" sx={{ minWidth: 64, textAlign: "center", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
              {query === "" ? "" : found.count === 0 ? "一致なし" : `${found.index + 1} / ${found.count}`}
            </Muted>
            <Tooltip title="前の一致 (Shift+Enter)">
              <span>
                <IconButton size="small" aria-label="前の一致" disabled={found.count === 0} onClick={() => run(step(editor.state, -1))}>
                  <ChevronUp size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="次の一致 (Enter)">
              <span>
                <IconButton size="small" aria-label="次の一致" disabled={found.count === 0} onClick={() => run(step(editor.state, 1))}>
                  <ChevronDown size={18} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="検索を閉じる (Esc)">
              <IconButton size="small" aria-label="検索を閉じる" onClick={close} sx={{ ml: 0.5 }}>
                <X size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
            <InputBase
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, () => run(replaceCurrent(editor.state, replacement)))}
              placeholder="置き換える文字"
              inputProps={{ "aria-label": "置き換える文字" }}
              sx={inputSx}
            />
            <Button variant="outlined" disabled={found.count === 0} onClick={() => run(replaceCurrent(editor.state, replacement))}>
              置換
            </Button>
            <Button variant="outlined" disabled={found.count === 0} onClick={() => run(replaceAll(editor.state, replacement))}>
              すべて置換
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
