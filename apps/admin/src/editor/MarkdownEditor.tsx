import ChecklistIcon from "@mui/icons-material/Checklist";
import CodeIcon from "@mui/icons-material/Code";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import LinkIcon from "@mui/icons-material/Link";
import RedoIcon from "@mui/icons-material/Redo";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import UndoIcon from "@mui/icons-material/Undo";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import { Tooltip } from "../components/Tooltip";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, type ReactNode } from "react";
import { monoFont } from "../theme";
import { editorExtensions } from "./extensions";

const extensions = [...editorExtensions, Placeholder.configure({ placeholder: "本文を書く…" })];

/**
 * 本文のWYSIWYGエディタ。値はMarkdownでやり取りする。
 * 読み込んだだけでは onChange を呼ばない（記法の正規化だけで「未保存」にならないように）。
 */
export function MarkdownEditor(props: { value: string; onChange: (md: string) => void }) {
  // エディタが最後に出した（または受け取った）Markdown。外からの差し替えと自分の編集を区別する
  const current = useRef(props.value);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  const editor = useEditor({
    extensions,
    content: props.value,
    contentType: "markdown",
    onUpdate: ({ editor }) => {
      current.current = editor.getMarkdown();
      onChange.current(current.current);
    },
  });

  // 版の復元や最新版の読み直しで、外から本文が差し替えられたとき
  useEffect(() => {
    if (props.value === current.current) return;
    current.current = props.value;
    editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
  }, [editor, props.value]);

  return (
    <Box>
      <Toolbar editor={editor} />
      <Box
        sx={{
          "& .tiptap": {
            outline: "none",
            minHeight: "50vh",
            pb: 12,
            fontSize: "1rem",
            lineHeight: 1.75,
            "& > :first-of-type": { mt: 0 },
            "& p": { my: 1 },
            "& h1, & h2, & h3, & h4": { fontWeight: 600, lineHeight: 1.35, mt: 3, mb: 1 },
            "& h1": { fontSize: "1.6rem" },
            "& h2": { fontSize: "1.35rem" },
            "& h3": { fontSize: "1.15rem" },
            "& a": { color: "primary.main", cursor: "text" },
            "& ul, & ol": { pl: 3, my: 1 },
            "& li > p": { my: 0.25 },
            "& ul[data-type='taskList']": {
              listStyle: "none",
              pl: 0.5,
              "& li": { display: "flex", gap: 1, alignItems: "flex-start" },
              "& li > label": { mt: "0.35em", flexShrink: 0 },
              "& li > div": { flex: 1, minWidth: 0 },
            },
            "& blockquote": { m: 0, my: 1.5, pl: 2, borderLeft: "3px solid", borderColor: "divider", color: "text.secondary" },
            "& code": { fontFamily: monoFont, fontSize: "0.875em", bgcolor: "action.hover", px: 0.5, py: 0.25, borderRadius: 0.5 },
            "& pre": {
              fontFamily: monoFont,
              bgcolor: "action.hover",
              p: 1.5,
              my: 1.5,
              borderRadius: 1,
              overflow: "auto",
              "& code": { bgcolor: "transparent", p: 0, fontSize: "0.875rem" },
            },
            "& hr": { border: 0, borderTop: "1px solid", borderColor: "divider", my: 3 },
            "& img": { maxWidth: "100%", borderRadius: 1 },
            "& img.ProseMirror-selectednode": { outline: "2px solid", outlineColor: "primary.main" },
            "& table": { borderCollapse: "collapse", my: 1.5, width: "100%", tableLayout: "fixed" },
            "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5, verticalAlign: "top", textAlign: "left" },
            "& th": { bgcolor: "action.hover", fontWeight: 600 },
            "& th p, & td p": { my: 0 },
            "& .selectedCell": { bgcolor: "action.selected" },
            "& p.is-editor-empty:first-of-type::before": {
              content: "attr(data-placeholder)",
              color: "text.disabled",
              float: "left",
              height: 0,
              pointerEvents: "none",
            },
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const href = prompt("リンク先のURL（空にするとリンクを外す）", prev);
    if (href === null) return;
    if (href.trim() === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };
  const addImage = () => {
    const src = prompt("画像のURL");
    if (src?.trim()) chain().setImage({ src: src.trim() }).run();
  };

  return (
    <Stack
      direction="row"
      role="toolbar"
      aria-label="書式"
      sx={{
        position: "sticky",
        top: 48,
        zIndex: 1,
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.25,
        py: 0.5,
        mb: 2,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {([1, 2, 3] as const).map((level) => (
        <Tool key={level} label={`見出し${level}`} active={state[`h${level}`]} onClick={() => chain().toggleHeading({ level }).run()}>
          <Box component="span" sx={{ fontSize: "0.8rem", fontWeight: 700, width: 20 }}>
            H{level}
          </Box>
        </Tool>
      ))}
      <Sep />
      <Tool label="太字 (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <FormatBoldIcon fontSize="small" />
      </Tool>
      <Tool label="斜体 (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <FormatItalicIcon fontSize="small" />
      </Tool>
      <Tool label="取り消し線" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <StrikethroughSIcon fontSize="small" />
      </Tool>
      <Tool label="インラインコード" active={state.code} onClick={() => chain().toggleCode().run()}>
        <CodeIcon fontSize="small" />
      </Tool>
      <Tool label="リンク" active={state.link} onClick={setLink}>
        <LinkIcon fontSize="small" />
      </Tool>
      <Sep />
      <Tool label="箇条書き" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
        <FormatListBulletedIcon fontSize="small" />
      </Tool>
      <Tool label="番号つきリスト" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        <FormatListNumberedIcon fontSize="small" />
      </Tool>
      <Tool label="チェックリスト" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
        <ChecklistIcon fontSize="small" />
      </Tool>
      <Sep />
      <Tool label="引用" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        <FormatQuoteIcon fontSize="small" />
      </Tool>
      <Tool label="コードブロック" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <DataObjectIcon fontSize="small" />
      </Tool>
      <Tool label="表" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <TableChartOutlinedIcon fontSize="small" />
      </Tool>
      <Tool label="画像" onClick={addImage}>
        <ImageOutlinedIcon fontSize="small" />
      </Tool>
      <Tool label="区切り線" onClick={() => chain().setHorizontalRule().run()}>
        <HorizontalRuleIcon fontSize="small" />
      </Tool>
      <Sep />
      <Tool label="元に戻す (⌘Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <UndoIcon fontSize="small" />
      </Tool>
      <Tool label="やり直す (⇧⌘Z)" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <RedoIcon fontSize="small" />
      </Tool>
    </Stack>
  );
}

function Tool(props: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip title={props.label}>
      <span>
        <IconButton
          size="small"
          aria-label={props.label}
          aria-pressed={props.active}
          disabled={props.disabled}
          // 押してもエディタの選択範囲を失わないようにする
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onClick}
          sx={[{ borderRadius: 1, width: 30, height: 30 }, !!props.active && { bgcolor: "action.selected", color: "primary.main" }]}
        >
          {props.children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function Sep() {
  return <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />;
}
