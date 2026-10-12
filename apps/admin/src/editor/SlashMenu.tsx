import { Braces, ChevronRight, Heading1, Heading2, Heading3, Image, List, ListChecks, ListOrdered, Megaphone, Minus, Quote, Table, MapPin } from "lucide-react";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import type { Editor } from "@tiptap/react";
import { useState, type ReactNode } from "react";
import { GoogleMapDialog } from "./GoogleMapDialog";
import { insertGoogleMap } from "./googleMap";
import { insertToggle } from "./toggle";
import { ImageDialog, insertImage } from "./LinkForm";
import { createTrigger, TriggerMenu, useTriggerMatch, type FindTrigger } from "./trigger";

/** 行頭か空白の直後の「/」から、カーソルまで（空白を含まない）。 */
export const findSlash: FindTrigger = (before) => {
  const m = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  return m ? { index: before.length - m[1]!.length - 1, query: m[1]! } : null;
};

export const slashTrigger = createTrigger("slashMenu", findSlash);

type Block = {
  id: string;
  label: string;
  /** ラベル以外に、絞り込みで当たる語（英語名やMarkdownの記法） */
  keywords: string[];
  icon: ReactNode;
  run: (editor: Editor, ui: { openImageDialog: () => void; openMapDialog: () => void }) => void;
};

const headingIcons = { 1: Heading1, 2: Heading2, 3: Heading3 } as const;
const headingIcon = (level: 1 | 2 | 3) => {
  const Icon = headingIcons[level];
  return <Icon size={18} />;
};

const chain = (editor: Editor) => editor.chain().focus();

const blocks: Block[] = [
  ...([1, 2, 3] as const).map(
    (level): Block => ({
      id: `h${level}`,
      label: `見出し${level}`,
      keywords: [`h${level}`, "heading", "midashi", "#".repeat(level)],
      icon: headingIcon(level),
      run: (e) => chain(e).setHeading({ level }).run(),
    }),
  ),
  { id: "bullet", label: "箇条書き", keywords: ["list", "ul", "bullet", "-"], icon: <List size={18} />, run: (e) => chain(e).toggleBulletList().run() },
  { id: "ordered", label: "番号つきリスト", keywords: ["list", "ol", "ordered", "number", "1."], icon: <ListOrdered size={18} />, run: (e) => chain(e).toggleOrderedList().run() },
  { id: "task", label: "チェックリスト", keywords: ["todo", "task", "check", "[]"], icon: <ListChecks size={18} />, run: (e) => chain(e).toggleTaskList().run() },
  { id: "quote", label: "引用", keywords: ["quote", "blockquote", ">"], icon: <Quote size={18} />, run: (e) => chain(e).setBlockquote().run() },
  { id: "code", label: "コードブロック", keywords: ["code", "pre", "```"], icon: <Braces size={18} />, run: (e) => chain(e).setCodeBlock().run() },
  { id: "table", label: "表", keywords: ["table", "hyou"], icon: <Table size={18} />, run: (e) => chain(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "image", label: "画像…", keywords: ["image", "img", "picture", "gazou"], icon: <Image size={18} />, run: (_e, ui) => ui.openImageDialog() },
  { id: "map", label: "Google マップ…", keywords: ["map", "google", "maps", "chizu", "地図"], icon: <MapPin size={18} />, run: (_e, ui) => ui.openMapDialog() },
  {
    id: "callout",
    label: "コールアウト（目立たせる注意書き）",
    keywords: ["callout", "note", "tip", "warning", "memo", "chuui"],
    icon: <Megaphone size={18} />,
    run: (e) => chain(e).setBlockquote().setCalloutType("note").run(),
  },
  {
    id: "toggle",
    label: "トグル（クリックで開閉する折りたたみ）",
    keywords: ["toggle", "details", "fold", "accordion", "oritatami", "+++"],
    icon: <ChevronRight size={18} />,
    run: (e) => insertToggle(e),
  },
  { id: "hr", label: "区切り線", keywords: ["hr", "divider", "line", "---"], icon: <Minus size={18} />, run: (e) => chain(e).setHorizontalRule().run() },
];

/** 絞り込みの文字に当たるブロックの id を、メニューに出す順で返す。 */
export function filterBlocks(query: string): string[] {
  const q = query.trim().toLowerCase();
  return blocks.filter((b) => q === "" || b.label.toLowerCase().includes(q) || b.keywords.some((k) => k.startsWith(q))).map((b) => b.id);
}

/** 本文で「/」を打つと出る、ブロックの挿入メニュー。続けて打った文字で絞り込める。 */
export function SlashMenu({ editor }: { editor: Editor }) {
  const match = useTriggerMatch(editor, slashTrigger);
  const ids = filterBlocks(match?.query ?? "");
  const [imageOpen, setImageOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <>
      <TriggerMenu
        editor={editor}
        trigger={slashTrigger}
        match={match}
        items={blocks.filter((b) => ids.includes(b.id))}
        itemKey={(b) => b.id}
        label="ブロックを挿入"
        emptyText={`「${match?.query ?? ""}」に当たるブロックはありません。`}
        renderItem={(b) => (
          <>
            <ListItemIcon>{b.icon}</ListItemIcon>
            <ListItemText>{b.label}</ListItemText>
          </>
        )}
        onChoose={(b, range) => {
          // 打ち込んだ「/…」を消してから、その行をブロックに変える
          editor.chain().focus().deleteRange(range).run();
          b.run(editor, { openImageDialog: () => setImageOpen(true), openMapDialog: () => setMapOpen(true) });
        }}
      />
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
    </>
  );
}
