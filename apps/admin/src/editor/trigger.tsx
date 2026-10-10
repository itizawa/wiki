import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Extension, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Muted, SkeletonRows } from "../components/ui";

/** カーソルの直前にある「記号＋絞り込みの文字」の範囲。 */
export type TriggerMatch = { from: number; to: number; query: string };

/** カーソルより前の文字列から、記号の位置と絞り込みの文字を取り出す。該当しなければ null。 */
export type FindTrigger = (textBefore: string) => { index: number; query: string } | null;

type TriggerState = { match: TriggerMatch | null; dismissedFrom: number | null };

export type Trigger = {
  extension: Extension;
  key: PluginKey<TriggerState>;
  /** メニューが出ている間のキー操作。メニュー側が差し替える */
  keys: { onKeyDown: ((event: KeyboardEvent) => boolean) | null };
};

function findMatch(state: EditorState, find: FindTrigger): TriggerMatch | null {
  const { selection } = state;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const found = find(before);
  if (!found) return null;
  return { from: $from.start() + found.index, to: $from.pos, query: found.query };
}

/**
 * 本文で記号（「/」など）を打つと、その場にメニューを出すための拡張。
 * フォーカスはエディタに置いたまま、続けて打った文字で候補を絞り込む。
 */
export function createTrigger(name: string, find: FindTrigger): Trigger {
  const key = new PluginKey<TriggerState>(name);
  const keys: Trigger["keys"] = { onKeyDown: null };
  const extension = Extension.create({
    name,
    addProseMirrorPlugins: () => [
      new Plugin<TriggerState>({
        key,
        state: {
          init: () => ({ match: null, dismissedFrom: null }),
          apply(tr, prev, _old, state) {
            const raw = findMatch(state, find);
            // Esc で閉じたあとは、同じ記号からは出し直さない
            const dismissedFrom = raw === null ? null : tr.getMeta(key) === "dismiss" ? raw.from : prev.dismissedFrom;
            return { match: raw && raw.from !== dismissedFrom ? raw : null, dismissedFrom };
          },
        },
        props: {
          handleKeyDown(view, event) {
            if (!key.getState(view.state)?.match) return false;
            // 日本語入力の変換を確定する Enter などは、メニューの操作にしない
            if (event.isComposing || view.composing) return false;
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(key, "dismiss"));
              return true;
            }
            return keys.onKeyDown?.(event) ?? false;
          },
        },
      }),
    ],
  });
  return { extension, key, keys };
}

export function useTriggerMatch(editor: Editor, trigger: Trigger): TriggerMatch | null {
  return useEditorState({ editor, selector: ({ editor: e }) => trigger.key.getState(e.state)?.match ?? null });
}

/** 記号の位置に出す候補の一覧。↑↓ で選び、Enter で決める。 */
export function TriggerMenu<T>(props: {
  editor: Editor;
  trigger: Trigger;
  match: TriggerMatch | null;
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onChoose: (item: T, match: TriggerMatch) => void;
  label: string;
  /** 候補が無いときに出す文 */
  emptyText: string;
  /** 候補を読み込んでいる間。候補がまだ無ければ、文の代わりに候補の行の形を出す */
  loading?: boolean;
}) {
  const { editor, trigger, match, items } = props;
  const [index, setIndex] = useState(0);
  const active = Math.min(index, Math.max(items.length - 1, 0));

  // 絞り込みが変わったら先頭に戻す
  useEffect(() => setIndex(0), [match?.query]);

  useEffect(() => {
    if (!match) return;
    trigger.keys.onKeyDown = (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length > 0) setIndex((active + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        if (!item) return false;
        props.onChoose(item, match);
        return true;
      }
      return false;
    };
    return () => {
      trigger.keys.onKeyDown = null;
    };
  });

  const from = match?.from;
  const anchor = useMemo(
    () => (from === undefined ? null : { getBoundingClientRect: () => rectAt(editor, from) }),
    [editor, from],
  );

  return (
    <Popper open={!!match} anchorEl={anchor} placement="bottom-start" modifiers={[{ name: "offset", options: { offset: [0, 6] } }]} sx={{ zIndex: 3 }}>
      <Paper elevation={4} sx={{ minWidth: 240, maxWidth: 360, maxHeight: 320, overflowY: "auto" }}>
        {items.length === 0 && props.loading ? (
          // 候補の行（アイコン + タイトル）と同じ高さ
          <SkeletonRows rows={3} height={32} icon sx={{ px: 1, py: 0.5 }} />
        ) : items.length === 0 ? (
          <Muted sx={{ px: 2, py: 1.25 }}>{props.emptyText}</Muted>
        ) : (
          <MenuList dense role="listbox" aria-label={props.label}>
            {items.map((item, i) => (
              <MenuItem
                key={props.itemKey(item)}
                role="option"
                aria-selected={i === active}
                selected={i === active}
                ref={i === active ? scrollIntoView : undefined}
                // 押してもエディタのフォーカスを失わないようにする
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => match && props.onChoose(item, match)}
              >
                {props.renderItem(item)}
              </MenuItem>
            ))}
          </MenuList>
        )}
      </Paper>
    </Popper>
  );
}

const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });

function rectAt(editor: Editor, pos: number): DOMRect {
  const { left, right, top, bottom } = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
  return new DOMRect(left, top, right - left, bottom - top);
}
