import Button from "@mui/material/Button";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { useEffect, useState } from "react";
import { Muted } from "../components/ui";

const options: BubbleMenuProps["options"] = { placement: "bottom", offset: 8, flip: { padding: { top: 56 } }, shift: { padding: 8 } };

const isImageSelected = (editor: Editor) => {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image";
};

const shouldShow: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, view, element }) =>
  isImageSelected(editor) && (view.hasFocus() || element.contains(document.activeElement));

/** 画像を選んだときに、その下に出す「画像の説明」の入力欄。Enter で設定する。 */
export function ImageMenu({ editor }: { editor: Editor }) {
  const alt = useEditorState({
    editor,
    selector: ({ editor: e }) => (isImageSelected(e) ? ((e.getAttributes("image").alt as string | null) ?? "") : null),
  });
  const [value, setValue] = useState(alt ?? "");
  // 別の画像を選んだら、その画像の説明に入れ替える
  useEffect(() => setValue(alt ?? ""), [alt]);
  const changed = alt !== null && value.trim() !== alt;

  return (
    <BubbleMenu editor={editor} shouldShow={shouldShow} options={options} style={{ zIndex: 1 }}>
      <Paper elevation={4}>
        <Stack
          direction="row"
          component="form"
          aria-label="画像の説明"
          onSubmit={(e) => {
            e.preventDefault();
            editor.chain().focus().updateAttributes("image", { alt: value.trim() }).run();
          }}
          sx={{ alignItems: "center", gap: 0.5, p: 0.5, pl: 1.25 }}
        >
          <Muted aria-hidden sx={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            説明
          </Muted>
          <InputBase
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setValue(alt ?? "");
                editor.commands.focus();
              }
            }}
            placeholder="例：管理画面のスクリーンショット"
            inputProps={{ "aria-label": "画像の説明（代替テキスト）" }}
            sx={{ width: 260, fontSize: "0.9rem" }}
          />
          <Button type="submit" variant="contained" disabled={!changed}>
            説明を設定
          </Button>
        </Stack>
      </Paper>
    </BubbleMenu>
  );
}
