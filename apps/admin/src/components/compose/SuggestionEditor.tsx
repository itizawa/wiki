import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRef, useState } from "react";
import { CalloutMenu } from "../../editor/CalloutMenu";
import { CodeBlockMenu } from "../../editor/CodeBlockMenu";
import { EmojiMenu, emojiTrigger } from "../../editor/EmojiMenu";
import { editorExtensions } from "../../editor/extensions";
import { ImageMenu } from "../../editor/ImageMenu";
import { ImageUpload } from "../../editor/imageUpload";
import { editorContentSx, InsertMenu, SelectionMenu } from "../../editor/MarkdownEditor";
import { mentionTrigger, PageMention } from "../../editor/PageMention";
import { SlashMenu, slashTrigger } from "../../editor/SlashMenu";
import { TableMenu } from "../../editor/TableMenu";

// 編集画面の本文と同じ拡張。「/」「@」「:」のメニューも同じものを使う（メニューの状態は拡張ごとに1つなので、同時に開く小さなエディタは1つだけにする）
const extensions = [...editorExtensions, slashTrigger.extension, mentionTrigger.extension, emojiTrigger.extension];

/**
 * 編集リクエストの置き換え案を書く、小さな WYSIWYG エディタ。編集画面の本文（`editor/MarkdownEditor.tsx`）と同じ拡張とメニューで、
 * 本文の中の検索と、タイトルとの行き来だけが無い。値は Markdown でやり取りする。
 *
 * - 画像は、貼り付け・ドロップ・「/」のメニューから入れられる（その場でアップロードされる。提案を送らずに画面を離れても、
 *   どこからも使われていない画像は、定期の掃除で消える）
 * - 「@」「[[」で、ほかのページへのリンクを入れられる
 *
 * 読み取り専用の本文（`ReviewBody`）の中に差し込んで使うので、外側の本文の見た目のうち、編集のじゃまになるものはここで打ち消す。
 */
export function SuggestionEditor(props: {
  /** 最初に入れる Markdown。あとから変えても、中身は差し替えない（差し替えるときは key を変えて作り直す） */
  initial: string;
  /** 読み上げ用の、入力欄の名前 */
  label: string;
  /** 入力欄の説明・エラーを出している要素の id */
  describedBy?: string;
  invalid?: boolean;
  /** 読み込んだ直後に、エディタが書き出した Markdown（書き換える前の形） */
  onReady: (markdown: string) => void;
  onChange: (markdown: string) => void;
}) {
  const onReady = useRef(props.onReady);
  onReady.current = props.onReady;
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  // 画像のアップロードに失敗した理由は、入力欄のすぐ下に出す
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [allExtensions] = useState(() => [...extensions, ImageUpload.configure({ onError: setUploadError })]);

  const editor = useEditor({
    extensions: allExtensions,
    content: props.initial,
    contentType: "markdown",
    // 入力欄として読み上げられるようにする
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": props.label, ...(props.describedBy ? { "aria-describedby": props.describedBy } : {}) },
    },
    onCreate: ({ editor }) => {
      // トグルは開いた状態で入れる（閉じたままだと、中身を直せることに気づけない）。開閉は Markdown に書かないので、書き換えには数えない
      const tr = editor.state.tr.setMeta("addToHistory", false);
      let lastToggleEnd = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "details") return;
        lastToggleEnd = Math.max(lastToggleEnd, pos + node.nodeSize - 1);
        if (!node.attrs.open) tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true });
      });
      if (tr.docChanged) editor.view.dispatch(tr);
      // 開いたらすぐ書けるよう、末尾にカーソルを置く。トグルがあれば、最後のトグルの中身の末尾（文書の末尾は、トグルの外になる）。
      // トグルを開いてからでないと、トグルの拡張が、隠れた中身に置いたカーソルを見出しへ戻してしまう。
      // エディタの autofocus は使わない（スマホで、フォーカスの途中に状態が変わって落ちることがあった）
      const { state } = editor;
      const end = lastToggleEnd >= 0 ? Selection.near(state.doc.resolve(lastToggleEnd), -1) : Selection.atEnd(state.doc);
      editor.view.dispatch(state.tr.setSelection(end).setMeta("addToHistory", false));
      editor.view.focus();
      onReady.current(editor.getMarkdown());
    },
    onUpdate: ({ editor }) => onChange.current(editor.getMarkdown()),
  });

  return (
    <Box>
      <SelectionMenu editor={editor} />
      <ImageMenu editor={editor} />
      <CalloutMenu editor={editor} />
      <InsertMenu editor={editor} />
      <PageMention editor={editor} />
      <SlashMenu editor={editor} />
      <EmojiMenu editor={editor} />
      <Box
        sx={{
          position: "relative",
          // 「挿入」のボタンは、左に余白が無いので行の右端に出す
          "& .insert-menu": { left: "auto !important", right: 4 },
          "& .tiptap": {
            ...editorContentSx,
            outline: "none",
            minHeight: 72,
            px: 1.5,
            py: 1,
            border: 1,
            borderColor: props.invalid ? "error.main" : "divider",
            borderRadius: 1,
            bgcolor: "background.default",
            color: "text.primary",
            cursor: "text",
            "&:focus-within, &.ProseMirror-focused": { borderColor: "primary.main", boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
            "& > :last-child": { mb: 0 },
            // 外側（読み取り専用の本文）の見た目を打ち消す
            "& a": { cursor: "text" },
            "& a::after": { content: "none" },
            "& ul[data-type='taskList'] li > label": { pointerEvents: "auto" },
            "& [data-type='details'] summary:empty::before": { content: '"トグルの見出し"', color: "text.disabled" },
            "& img.ProseMirror-selectednode": { outline: "2px solid", outlineColor: "primary.main" },
            "& .image-uploading": { display: "inline-block", px: 1, py: 0.25, borderRadius: 1, border: "1px dashed", borderColor: "divider", color: "text.secondary", fontSize: "0.85rem" },
            "& .selectedCell": { bgcolor: "action.selected" },
          },
        }}
      >
        <EditorContent editor={editor} />
        <TableMenu editor={editor} />
      </Box>
      <CodeBlockMenu editor={editor} />
      {uploadError && (
        <Alert severity="error" onClose={() => setUploadError(null)} sx={{ mt: 1, py: 0 }}>
          {uploadError}
        </Alert>
      )}
    </Box>
  );
}
