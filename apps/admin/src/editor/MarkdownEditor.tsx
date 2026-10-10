import AddIcon from "@mui/icons-material/Add";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
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
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { Tooltip } from "../components/Tooltip";
import { Placeholder } from "@tiptap/extensions";
import { ImageDialog, LinkForm } from "./LinkForm";
import { NodeSelection } from "@tiptap/pm/state";
import { CalloutMenu, calloutSx } from "./CalloutMenu";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu, FloatingMenu, type BubbleMenuProps, type FloatingMenuProps } from "@tiptap/react/menus";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { monoFont } from "../theme";
import { TableMenu } from "./TableMenu";
import { editorExtensions } from "./extensions";
import { mentionTrigger, PageMention } from "./PageMention";
import { SlashMenu, slashTrigger } from "./SlashMenu";

const extensions = [...editorExtensions, slashTrigger.extension, mentionTrigger.extension, Placeholder.configure({ placeholder: "本文を書く…「/」でブロックを挿入" })];

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
      <SelectionMenu editor={editor} />
      <CalloutMenu editor={editor} />
      <InsertMenu editor={editor} />
      <PageMention editor={editor} />
      <SlashMenu editor={editor} />
      <Box
        sx={{
          // 浮かぶメニューの位置の基準
          position: "relative",
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
        <TableMenu editor={editor} />
      </Box>
    </Box>
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
      <Paper elevation={4}>
        {linkEditing && (
          <LinkForm
            initial={(editor.getAttributes("link").href as string | undefined) ?? ""}
            onSubmit={(href) => closeLink(() => chain().extendMarkRange("link").setLink({ href }).run())}
            onRemove={state.link ? () => closeLink(() => chain().extendMarkRange("link").unsetLink().run()) : undefined}
            onClose={() => closeLink(() => editor.commands.focus())}
          />
        )}
        <Stack direction="row" role="toolbar" aria-label="書式" sx={{ display: linkEditing ? "none" : "flex", alignItems: "center", gap: 0.25, p: 0.5 }}>
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
          <Tool label={state.link ? "リンクを編集" : "リンク"} active={state.link} onClick={() => setLinkEditing(true)}>
            <LinkIcon fontSize="small" />
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
            <FormatQuoteIcon fontSize="small" />
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

  return (
    <FloatingMenu editor={editor} options={insertMenuOptions} style={{ zIndex: 1 }}>
      <Tooltip title="挿入">
        <IconButton
          size="small"
          aria-label="挿入"
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ borderRadius: 1, width: 24, height: 24, color: "text.secondary" }}
        >
          <AddIcon fontSize="small" />
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
        <MenuItem onClick={insert(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
          <ListItemIcon>
            <TableChartOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>表</ListItemText>
        </MenuItem>
        <MenuItem onClick={insert(() => setImageOpen(true))}>
          <ListItemIcon>
            <ImageOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>画像…</ListItemText>
        </MenuItem>
        <MenuItem onClick={insert(() => chain().toggleCodeBlock().run())}>
          <ListItemIcon>
            <DataObjectIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コードブロック</ListItemText>
        </MenuItem>
        <MenuItem onClick={insert(() => chain().setBlockquote().setCalloutType("note").run())}>
          <ListItemIcon>
            <CampaignOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コールアウト（目立たせる注意書き）</ListItemText>
        </MenuItem>
        <MenuItem onClick={insert(() => chain().setHorizontalRule().run())}>
          <ListItemIcon>
            <HorizontalRuleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>区切り線</ListItemText>
        </MenuItem>
      </Menu>
      <ImageDialog
        open={imageOpen}
        onSubmit={(image) => {
          setImageOpen(false);
          // 画像の下に空行を足してカーソルを置く（画像が選択されたままだと、次に打った文字で画像が置き換わるため）
          chain().insertContent([{ type: "image", attrs: image }, { type: "paragraph" }]).run();
        }}
        onClose={() => {
          setImageOpen(false);
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
