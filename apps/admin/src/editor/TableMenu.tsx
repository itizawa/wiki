import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Editor } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { useCallback, type ReactNode } from "react";

// ページ上部に固定されたヘッダー（48px）の下に隠れないよう、上に余白がなければ表の下に出す
const options: BubbleMenuProps["options"] = { placement: "top-start", offset: 6, flip: { padding: { top: 56 } }, shift: { padding: 8 } };

const shouldShow: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, element, view, state }) => {
  // 表の中にカーソルがあるときだけ出す。文字を選んでいる間は書式メニューに譲る
  if (!editor.isActive("table") || !state.selection.empty) return false;
  return view.hasFocus() || element.contains(document.activeElement);
};

/** カーソルが表の中にあるとき、表の上に出る行・列の操作メニュー。 */
export function TableMenu({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  // カーソルの位置ではなく、表の左上を基準に出す（行を移っても動かないように）
  const tableRect = useCallback(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const table = (node instanceof Element ? node : node.parentElement)?.closest("table");
    return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
  }, [editor]);

  return (
    <BubbleMenu editor={editor} pluginKey="tableMenu" shouldShow={shouldShow} getReferencedVirtualElement={tableRect} options={options} style={{ zIndex: 1 }}>
      <Paper elevation={4}>
        <Stack direction="row" role="toolbar" aria-label="表の操作" sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.25, p: 0.5 }}>
          <Group label="行">
            <Action label="上に行を追加" onClick={() => chain().addRowBefore().run()}>
              上に追加
            </Action>
            <Action label="下に行を追加" onClick={() => chain().addRowAfter().run()}>
              下に追加
            </Action>
            <Action label="この行を削除" onClick={() => chain().deleteRow().run()}>
              削除
            </Action>
          </Group>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />
          <Group label="列">
            <Action label="左に列を追加" onClick={() => chain().addColumnBefore().run()}>
              左に追加
            </Action>
            <Action label="右に列を追加" onClick={() => chain().addColumnAfter().run()}>
              右に追加
            </Action>
            <Action label="この列を削除" onClick={() => chain().deleteColumn().run()}>
              削除
            </Action>
          </Group>
          {/* 表ごと消す操作は、行・列の操作から離して置く */}
          <Divider orientation="vertical" flexItem sx={{ ml: 0.5, mr: 2, my: 0.75 }} />
          <Action label="表を削除" color="error" onClick={() => chain().deleteTable().run()}>
            表を削除
          </Action>
        </Stack>
      </Paper>
    </BubbleMenu>
  );
}

function Group(props: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" role="group" aria-label={props.label} sx={{ alignItems: "center", gap: 0.25 }}>
      <Typography variant="caption" sx={{ px: 0.75, color: "text.secondary", fontWeight: 600 }}>
        {props.label}
      </Typography>
      {props.children}
    </Stack>
  );
}

function Action(props: { label: string; color?: "error"; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      aria-label={props.label}
      color={props.color ?? "inherit"}
      // 押してもエディタのカーソルを失わないようにする
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      sx={{ minWidth: 0, px: 0.75, whiteSpace: "nowrap" }}
    >
      {props.children}
    </Button>
  );
}
