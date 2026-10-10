import Box from "@mui/material/Box";
import NativeSelect from "@mui/material/NativeSelect";
import Paper from "@mui/material/Paper";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { CALLOUT_LABELS, CALLOUT_TYPES, type CalloutType } from "@wiki/shared";
import { useCallback } from "react";

const options: BubbleMenuProps["options"] = { placement: "top-end", offset: 4, flip: { padding: { top: 56 } }, shift: { padding: 8 } };

const shouldShow: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, element, view, state }) =>
  // 文字を選んでいる間は書式メニューに譲る
  editor.isActive("blockquote") && state.selection.empty && (view.hasFocus() || element.contains(document.activeElement));

/** カーソルが引用の中にあるとき、右上に出る種類の選択（ふつうの引用か、コールアウトの種類か）。 */
export function CalloutMenu({ editor }: { editor: Editor }) {
  const type = useEditorState({ editor, selector: ({ editor: e }) => (e.getAttributes("blockquote").callout as CalloutType | null) ?? "" });
  const blockRect = useCallback(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const quote = (node instanceof Element ? node : node.parentElement)?.closest("blockquote");
    return quote ? { getBoundingClientRect: () => quote.getBoundingClientRect() } : null;
  }, [editor]);

  return (
    <BubbleMenu editor={editor} pluginKey="calloutMenu" shouldShow={shouldShow} getReferencedVirtualElement={blockRect} options={options} style={{ zIndex: 1 }}>
      <Paper elevation={4} sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.25, pr: 0.5, py: 0.25 }}>
        <Box component="label" htmlFor="callout-type" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "text.secondary" }}>
          種類
        </Box>
        <NativeSelect
          disableUnderline
          value={type}
          onChange={(e) => editor.chain().focus().setCalloutType((e.target.value || null) as CalloutType | null).run()}
          inputProps={{ id: "callout-type" }}
          sx={{ fontSize: "0.85rem" }}
        >
          <option value="">ふつうの引用</option>
          {CALLOUT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CALLOUT_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Paper>
    </BubbleMenu>
  );
}

/** コールアウトの種類ごとの色（テーマのパレット名）。 */
const COLORS: Record<CalloutType, string> = { note: "primary", tip: "success", important: "primary", warning: "warning", caution: "error" };

/** 編集画面でのコールアウトの見た目。色に加えて、種類の名前を先頭に出す。 */
export const calloutSx = Object.fromEntries(
  CALLOUT_TYPES.map((t) => [
    `& blockquote[data-callout="${t}"]`,
    {
      color: "text.primary",
      borderLeftColor: `${COLORS[t]}.main`,
      bgcolor: "action.hover",
      borderRadius: 1,
      py: 1,
      pr: 2,
      "&::before": { content: `"${CALLOUT_LABELS[t]}"`, display: "block", fontSize: "0.8rem", fontWeight: 700, color: `${COLORS[t]}.main` },
    },
  ]),
);
