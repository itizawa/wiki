import { Bold, Braces, ChevronRight, Code, GripVertical, Image, Italic, Link, List, ListChecks, ListOrdered, MapPin, Megaphone, Minus, Plus, Quote, Strikethrough, Table } from "lucide-react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Tooltip } from "../components/Tooltip";
import { FindBar } from "./FindBar";
import { Placeholder } from "@tiptap/extensions";
import { insertToggle } from "./toggle";
import { GoogleMapDialog } from "./GoogleMapDialog";
import { insertGoogleMap } from "./googleMap";
import { ImageDialog, insertImage, LinkForm } from "./LinkForm";
import { NodeSelection } from "@tiptap/pm/state";
import { CalloutMenu, calloutSx } from "./CalloutMenu";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { CodeBlockMenu } from "./CodeBlockMenu";
import { ImageMenu } from "./ImageMenu";
import { ImageUpload } from "./imageUpload";
import { BubbleMenu, FloatingMenu, type BubbleMenuProps, type FloatingMenuProps } from "@tiptap/react/menus";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MENU_MAX_WIDTH, monoFont, TOUCH } from "../theme";
import { TableMenu } from "./TableMenu";
import { setBlockDragging } from "./blockMove";
import { editorExtensions } from "./extensions";
import { highlightSx } from "./highlight";
import { OUTLINE_SCROLL_MARGIN } from "./Outline";
import { EmojiMenu, emojiTrigger } from "./EmojiMenu";
import { mentionTrigger, PageMention } from "./PageMention";
import { SlashMenu, slashTrigger } from "./SlashMenu";
import { TitleBridge } from "./titleBridge";

const extensions = [...editorExtensions, slashTrigger.extension, mentionTrigger.extension, emojiTrigger.extension, Placeholder.configure({ placeholder: "本文を書く…「/」でブロックを挿入" })];

/**
 * 本文の見た目（見出し・リスト・引用・コールアウト・コード・トグル・表・画像）。
 * 編集画面の本文と、プレゼンモードのスライド（components/Presentation.tsx）で同じものを使う。編集中にだけ要るものは入れない
 */
export const editorContentSx = {
  fontSize: "1rem",
  lineHeight: 1.75,
  "& > :first-of-type": { mt: 0 },
  "& p": { my: 1 },
  "& h1, & h2, & h3, & h4": { fontWeight: 600, lineHeight: 1.35, mt: 3, mb: 1 },
  "& h1": { fontSize: "1.6rem" },
  "& h2": { fontSize: "1.35rem" },
  "& h3": { fontSize: "1.15rem" },
  "& a": { color: "primary.main" },
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
  ...calloutSx,
  "& code": { fontFamily: monoFont, fontSize: "0.875em", bgcolor: "action.hover", px: 0.5, py: 0.25, borderRadius: 0.5 },
  "& pre": {
    fontFamily: monoFont,
    bgcolor: "action.hover",
    p: 1.5,
    my: 1.5,
    borderRadius: 1,
    overflow: "auto",
    "& code": { bgcolor: "transparent", p: 0, fontSize: "0.875rem" },
    ...highlightSx,
  },
  // トグル（@tiptap/extension-details の部品）。左の三角で開閉する
  "& [data-type='details']": { display: "flex", alignItems: "flex-start", gap: 0.5, my: 1 },
  "& [data-type='details'] > button": {
    flexShrink: 0,
    width: 24,
    height: 24,
    mt: "3px",
    p: 0,
    border: 0,
    borderRadius: 0.5,
    bgcolor: "transparent",
    color: "text.secondary",
    cursor: "pointer",
    "&::before": { content: '"▶"', display: "inline-block", fontSize: "0.7rem", transition: "transform 120ms" },
    "&:hover": { bgcolor: "action.hover" },
  },
  "& [data-type='details'].is-open > button::before": { transform: "rotate(90deg)" },
  "& [data-type='details'] > div": { flex: 1, minWidth: 0 },
  "& [data-type='details'] summary": { display: "block", fontWeight: 600, listStyle: "none" },
  "& [data-type='detailsContent'] > :first-of-type": { mt: 0.5 },
  "& hr": { border: 0, borderTop: "1px solid", borderColor: "divider", my: 3 },
  "& img": { maxWidth: "100%", borderRadius: 1 },
  "& table": { borderCollapse: "collapse", my: 1.5, width: "100%", tableLayout: "fixed" },
  "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5, verticalAlign: "top", textAlign: "left" },
  "& th": { bgcolor: "action.hover", fontWeight: 600 },
  "& th p, & td p": { my: 0 },
} as const;

/**
 * 本文のWYSIWYGエディタ。値はMarkdownでやり取りする。
 * 読み込んだだけでは onChange を呼ばない（記法の正規化だけで「未保存」にならないように）。
 */
export function MarkdownEditor(props: {
  value: string;
  onChange: (md: string) => void;
  onEditor?: (editor: Editor) => void;
  /** 本文の先頭から上へ出ようとした（先頭の行の ↑、いちばん先頭の Backspace）。上にタイトルがある画面が、そこへフォーカスを移す */
  onLeaveTop?: () => void;
}) {
  // エディタが最後に出した（または受け取った）Markdown。外からの差し替えと自分の編集を区別する
  const current = useRef(props.value);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onLeaveTop = useRef(props.onLeaveTop);
  onLeaveTop.current = props.onLeaveTop;

  // 画像のアップロードに失敗したときの知らせ（貼り付け・ドロップは本文の外に結果を出す場所が無いので、ここに出す）
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [allExtensions] = useState(() => [
    ...extensions,
    ImageUpload.configure({ onError: setUploadError }),
    TitleBridge.configure({
      onLeaveTop: () => {
        onLeaveTop.current?.();
        return !!onLeaveTop.current;
      },
    }),
  ]);

  const editor = useEditor({
    extensions: allExtensions,
    content: props.value,
    contentType: "markdown",
    onUpdate: ({ editor }) => {
      current.current = editor.getMarkdown();
      onChange.current(current.current);
    },
  });

  const onEditor = props.onEditor;
  useEffect(() => {
    onEditor?.(editor);
  }, [editor, onEditor]);

  // 版の復元や最新版の読み直しで、外から本文が差し替えられたとき
  useEffect(() => {
    if (props.value === current.current) return;
    current.current = props.value;
    editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
  }, [editor, props.value]);

  return (
    <Box>
      <FindBar editor={editor} />
      <SelectionMenu editor={editor} />
      <ImageMenu editor={editor} />
      <CalloutMenu editor={editor} />
      <InsertMenu editor={editor} />
      <PageMention editor={editor} />
      <SlashMenu editor={editor} />
      <EmojiMenu editor={editor} />
      <Box
        sx={(t) => ({
          // 浮かぶメニューの位置の基準
          position: "relative",
          // 「挿入」のボタンは行の左の余白に出す。狭い画面では余白が 16px しか無く、画面の外にはみ出すので、行の右端に出す
          [t.breakpoints.down("md")]: { "& .insert-menu": { left: "auto !important", right: 0 } },
          // ハンドルでブロックを動かしている間は、標準の落とす位置のカーソル（リストの項目の中にも出る）を隠し、最上位のブロックの間の線だけを出す
          "&:has(.tiptap[data-block-dragging]) .prosemirror-dropcursor-block": { display: "none" },
          "& .tiptap": {
            outline: "none",
            minHeight: "50vh",
            pb: 12,
            ...editorContentSx,
            // 目次から飛んだとき、見出しが固定したヘッダーの下に隠れないようにする
            "& :is(h1, h2, h3, h4), & [data-type='details']": { scrollMarginTop: `${OUTLINE_SCROLL_MARGIN}px` },
            "& a": { color: "primary.main", cursor: "text" },
            "& [data-type='details'] summary:empty::before": { content: '"トグルの見出し"', color: "text.disabled" },
            // ハンドルでブロックを動かしているとき、落とす位置の線（ブロックの上か下に出す）
            "& .block-drop-before": { boxShadow: `0 -4px 0 -2px ${t.palette.primary.main}` },
            "& .block-drop-after": { boxShadow: `0 4px 0 -2px ${t.palette.primary.main}` },
            "& img.ProseMirror-selectednode": { outline: "2px solid", outlineColor: "primary.main" },
            "& .image-uploading": {
              display: "inline-block",
              px: 1,
              py: 0.25,
              borderRadius: 1,
              border: "1px dashed",
              borderColor: "divider",
              color: "text.secondary",
              fontSize: "0.85rem",
            },
            "& .selectedCell": { bgcolor: "action.selected" },
            // 検索で一致した箇所。いま見ている1つは、色に加えて枠でも区別する
            "& .find-match": { bgcolor: "find.match", borderRadius: "2px" },
            "& .find-current": { bgcolor: "find.current", outline: "2px solid", outlineColor: "warning.main" },
            "& p.is-editor-empty:first-of-type::before": {
              content: "attr(data-placeholder)",
              color: "text.disabled",
              float: "left",
              height: 0,
              pointerEvents: "none",
            },
          },
        })}
      >
        <EditorContent editor={editor} />
        <BlockDragHandle editor={editor} />
        <TableMenu editor={editor} />
      </Box>
      <CodeBlockMenu editor={editor} />
      <Snackbar open={uploadError !== null} autoHideDuration={8000} onClose={() => setUploadError(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" variant="filled" onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// ハンドルの位置。行の左の余白に出し、空行の「挿入」ボタン（行の左 4px）と重ならないよう、さらに左へ置く
// 左へずらすのは、外枠の余白ではなくオフセットでやる（外枠はライブラリが draggable にするので、大きくしたり pointer-events を切ったりするとつかめなくなる）
const dragHandlePositionAt = (offset: number) => ({ placement: "left-start" as const, strategy: "absolute" as const, middleware: [{ name: "shiftLeft", fn: ({ x, y }: { x: number; y: number }) => ({ x: x - offset, y }) }] });
const dragHandlePosition = { wide: dragHandlePositionAt(28), narrow: dragHandlePositionAt(4) };

/**
 * ブロック（段落・見出し・リスト全体・表・画像など、最上位のもの）にマウスを乗せると左に出る、つかんで動かすハンドル。
 * 指で操作する端末（TOUCH）では出さない（ドラッグは対象外）。キーボードでは Alt+↑↓（extensions の BlockMove）。
 */
function BlockDragHandle({ editor }: { editor: Editor }) {
  const touch = useMediaQuery(TOUCH);
  // つかんでいる間は、ツールチップが動かす先の見えるところを隠さないよう出さない
  const [dragging, setDragging] = useState(false);
  const narrow = useMediaQuery((t: Theme) => t.breakpoints.down("md"));
  if (touch) return null;
  return (
    <DragHandle
      editor={editor}
      computePositionConfig={dragHandlePosition[narrow ? "narrow" : "wide"]}
      className="block-drag-handle"
      onElementDragStart={() => {
        setDragging(true);
        setBlockDragging(editor, true);
      }}
      onElementDragEnd={() => {
        setDragging(false);
        setBlockDragging(editor, false);
      }}
    >
      {/* Tab の順には入れない（本文の中の Tab を増やさない）。キーボードでは Alt+↑↓ */}
      <Tooltip title="ドラッグして動かす（Alt+↑↓ でも動かせる）" placement="top" {...(dragging && { open: false })}>
        <Box
          role="img"
          aria-label="ブロックを動かす"
          sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 1, color: "text.secondary", cursor: "grab", "&:hover": { bgcolor: "action.hover" }, "&:active": { cursor: "grabbing" } }}
        >
          <GripVertical size={18} />
        </Box>
      </Tooltip>
    </DragHandle>
  );
}

// メニューに渡す設定は毎回同じ参照にする（変わるたびにエディタへ再設定が走るため）
// ページ上部に固定されたヘッダー（48px）の下に隠れないよう、上に余白がなければ選択範囲の下に出す
const selectionMenuOptions: BubbleMenuProps["options"] = { placement: "top", offset: 8, flip: { padding: { top: 56 } }, shift: { padding: 8 } };
const insertMenuOptions: FloatingMenuProps["options"] = { placement: "left", offset: 4, flip: false, shift: { padding: 4 } };

const showSelectionMenu: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, element, view, state, from, to }) => {
  const { selection } = state;
  // 文字を選んでいるときだけ出す。画像の選択や、書式をつけられないコードブロックの中では出さない
  if (selection.empty || selection instanceof NodeSelection || editor.isActive("codeBlock")) return false;
  if (state.doc.textBetween(from, to).length === 0) return false;
  return view.hasFocus() || element.contains(document.activeElement);
};

/** 文字を選択したときに、その近くに浮かぶ書式メニュー。 */
function SelectionMenu({ editor }: { editor: Editor }) {
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
      link: e.isActive("link"),
    }),
  });
  const chain = () => editor.chain().focus();

  // リンク先を入れている間は、書式ボタンの代わりに入力欄を出す
  const [linkEditing, setLinkEditing] = useState(false);
  const closeLink = (run: () => void) => {
    setLinkEditing(false);
    run();
  };
  // 選択範囲を変えたら（別の場所をクリックしたら）、入力欄は閉じる
  useEffect(() => {
    const reset = () => setLinkEditing(false);
    editor.on("selectionUpdate", reset);
    return () => void editor.off("selectionUpdate", reset);
  }, [editor]);

  return (
    <BubbleMenu editor={editor} shouldShow={showSelectionMenu} options={selectionMenuOptions} style={{ zIndex: 1 }}>
      {/* スマホの幅では1行に収まらないので、画面の幅で折り返す（折り返さないと、右のボタンが画面の外に出て押せない） */}
      <Paper elevation={4} sx={{ maxWidth: MENU_MAX_WIDTH }}>
        {linkEditing && (
          <LinkForm
            initial={(editor.getAttributes("link").href as string | undefined) ?? ""}
            onSubmit={(href) => closeLink(() => chain().extendMarkRange("link").setLink({ href }).run())}
            onRemove={state.link ? () => closeLink(() => chain().extendMarkRange("link").unsetLink().run()) : undefined}
            onClose={() => closeLink(() => editor.commands.focus())}
          />
        )}
        <Stack direction="row" role="toolbar" aria-label="書式" sx={{ display: linkEditing ? "none" : "flex", alignItems: "center", flexWrap: "wrap", gap: 0.25, p: 0.5 }}>
          <Tool label="太字 (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
            <Bold size={18} />
          </Tool>
          <Tool label="斜体 (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
            <Italic size={18} />
          </Tool>
          <Tool label="取り消し線" active={state.strike} onClick={() => chain().toggleStrike().run()}>
            <Strikethrough size={18} />
          </Tool>
          <Tool label="インラインコード" active={state.code} onClick={() => chain().toggleCode().run()}>
            <Code size={18} />
          </Tool>
          <Tool label={state.link ? "リンクを編集" : "リンク"} active={state.link} onClick={() => setLinkEditing(true)}>
            <Link size={18} />
          </Tool>
          <Sep />
          {([1, 2, 3] as const).map((level) => (
            <Tool key={level} label={`見出し${level}`} active={state[`h${level}`]} onClick={() => chain().toggleHeading({ level }).run()}>
              <Box component="span" sx={{ fontSize: "0.8rem", fontWeight: 700, width: 20 }}>
                H{level}
              </Box>
            </Tool>
          ))}
          <Tool label="引用" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
            <Quote size={18} />
          </Tool>
          <Sep />
          <Tool label="箇条書き" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
            <List size={18} />
          </Tool>
          <Tool label="番号つきリスト" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
            <ListOrdered size={18} />
          </Tool>
          <Tool label="チェックリスト" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
            <ListChecks size={18} />
          </Tool>
        </Stack>
      </Paper>
    </BubbleMenu>
  );
}

/** 空行にカーソルがあるとき、行の左に出る「挿入」ボタン。選択範囲がいらないブロックをここから入れる。 */
function InsertMenu({ editor }: { editor: Editor }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chain = () => editor.chain().focus();
  // メニューが閉じきってから実行する。開いている間はメニューがフォーカスを握っていて、エディタに戻せないため
  const afterClose = useRef<(() => void) | null>(null);
  // 何も選ばずに閉じたときも、エディタにフォーカスを戻してそのまま書き続けられるようにする
  const close = (run: () => void = () => editor.commands.focus()) => {
    afterClose.current = run;
    setAnchor(null);
  };
  const insert = (run: () => void) => () => close(run);
  const [imageOpen, setImageOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // 「挿入」の説明。FloatingMenu が隠れるとき、ボタンからは mouseleave が来ず、開いたまま画面の隅に残るので、
  // 文字を打つ・選択が動くたびに閉じる（開閉は自分で持つ）
  const [tipOpen, setTipOpen] = useState(false);
  useEffect(() => {
    const hide = () => setTipOpen(false);
    editor.on("update", hide);
    editor.on("selectionUpdate", hide);
    return () => {
      editor.off("update", hide);
      editor.off("selectionUpdate", hide);
    };
  }, [editor]);

  return (
    <FloatingMenu editor={editor} options={insertMenuOptions} className="insert-menu" style={{ zIndex: 1 }}>
      <Tooltip title="挿入" open={tipOpen && !anchor} onOpen={() => setTipOpen(true)} onClose={() => setTipOpen(false)}>
        <IconButton
          size="small"
          aria-label="挿入"
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ borderRadius: 1, width: 24, height: 24, color: "text.secondary", [TOUCH]: { width: 32, height: 32 } }}
        >
          <Plus size={18} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => close()}
        disableRestoreFocus
        // 閉じるときは待たせない（閉じる途中に打った文字がメニューに吸われるため）
        transitionDuration={{ enter: 150, exit: 0 }}
        slotProps={{
          transition: {
            onExited: () => {
              afterClose.current?.();
              afterClose.current = null;
            },
          },
        }}
      >
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
          <ListItemIcon>
            <Table size={18} />
          </ListItemIcon>
          <ListItemText>表</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => setImageOpen(true))}>
          <ListItemIcon>
            <Image size={18} />
          </ListItemIcon>
          <ListItemText>画像…</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => setMapOpen(true))}>
          <ListItemIcon>
            <MapPin size={18} />
          </ListItemIcon>
          <ListItemText>Google マップ…</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => chain().toggleCodeBlock().run())}>
          <ListItemIcon>
            <Braces size={18} />
          </ListItemIcon>
          <ListItemText>コードブロック</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => chain().setBlockquote().setCalloutType("note").run())}>
          <ListItemIcon>
            <Megaphone size={18} />
          </ListItemIcon>
          <ListItemText>コールアウト（目立たせる注意書き）</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => insertToggle(editor))}>
          <ListItemIcon>
            <ChevronRight size={18} />
          </ListItemIcon>
          <ListItemText>トグル（クリックで開閉する折りたたみ）</ListItemText>
        </MenuItem>
        <MenuItem sx={{ whiteSpace: "normal" }} onClick={insert(() => chain().setHorizontalRule().run())}>
          <ListItemIcon>
            <Minus size={18} />
          </ListItemIcon>
          <ListItemText>区切り線</ListItemText>
        </MenuItem>
      </Menu>
      <ImageDialog
        open={imageOpen}
        onSubmit={(image) => {
          setImageOpen(false);
          insertImage(editor, image);
        }}
        onClose={() => {
          setImageOpen(false);
          editor.commands.focus();
        }}
      />
      <GoogleMapDialog
        open={mapOpen}
        onSubmit={(url) => {
          setMapOpen(false);
          insertGoogleMap(editor, url);
        }}
        onClose={() => {
          setMapOpen(false);
          editor.commands.focus();
        }}
      />
    </FloatingMenu>
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
          // 指で操作する端末では大きくする。ボタンの間が狭いので、押せる範囲は見た目どおりにする
          sx={[{ borderRadius: 1, width: 30, height: 30, [TOUCH]: { width: 36, height: 36, "&::after": { display: "none" } } }, !!props.active && { bgcolor: "action.selected", color: "primary.main" }]}
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

// 編集リクエストを出すときの小さなエディタ（components/compose/SuggestionEditor.tsx）が、同じメニューを使う
export { InsertMenu, SelectionMenu };
