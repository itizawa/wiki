import Box from "@mui/material/Box";
import NativeSelect from "@mui/material/NativeSelect";
import Paper from "@mui/material/Paper";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { useCallback } from "react";

/** よく使う言語。値は Markdown のコードフェンス（```ts など）にそのまま書かれる。 */
export const LANGUAGES: { value: string; label: string }[] = [
  { value: "bash", label: "Bash" },
  { value: "css", label: "CSS" },
  { value: "diff", label: "Diff" },
  { value: "go", label: "Go" },
  { value: "html", label: "HTML" },
  { value: "js", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "md", label: "Markdown" },
  { value: "python", label: "Python" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "ts", label: "TypeScript" },
  { value: "tsx", label: "TSX" },
  { value: "yaml", label: "YAML" },
];

/** 選択肢の一覧。いまの言語が一覧に無ければ（手書きの ```kotlin など）、それも選択肢に入れて消えないようにする。 */
export function languageOptions(current: string): { value: string; label: string }[] {
  const known = LANGUAGES.some((l) => l.value === current);
  return [{ value: "", label: "指定なし" }, ...(current && !known ? [{ value: current, label: current }] : []), ...LANGUAGES];
}

const options: BubbleMenuProps["options"] = { placement: "top-end", offset: 4, flip: { padding: { top: 56 } }, shift: { padding: 8 } };

const shouldShow: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, element, view }) =>
  editor.isActive("codeBlock") && (view.hasFocus() || element.contains(document.activeElement));

/** カーソルがコードブロックの中にあるとき、右上に出る言語の選択。 */
export function CodeBlockMenu({ editor }: { editor: Editor }) {
  const language = useEditorState({ editor, selector: ({ editor: e }) => (e.getAttributes("codeBlock").language as string | null) ?? "" });
  const blockRect = useCallback(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const pre = (node instanceof Element ? node : node.parentElement)?.closest("pre");
    return pre ? { getBoundingClientRect: () => pre.getBoundingClientRect() } : null;
  }, [editor]);

  return (
    <BubbleMenu editor={editor} pluginKey="codeBlockMenu" shouldShow={shouldShow} getReferencedVirtualElement={blockRect} options={options} style={{ zIndex: 1 }}>
      <Paper elevation={4} sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1.25, pr: 0.5, py: 0.25 }}>
        <Box component="label" htmlFor="code-language" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "text.secondary" }}>
          言語
        </Box>
        <NativeSelect
          disableUnderline
          value={language}
          onChange={(e) => editor.chain().focus().updateAttributes("codeBlock", { language: e.target.value || null }).run()}
          inputProps={{ id: "code-language" }}
          sx={{ fontSize: "0.85rem" }}
        >
          {languageOptions(language).map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </NativeSelect>
      </Paper>
    </BubbleMenu>
  );
}
