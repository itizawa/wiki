import ChecklistIcon from "@mui/icons-material/Checklist";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import TitleIcon from "@mui/icons-material/Title";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
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
  run: (editor: Editor) => void;
};

const chain = (editor: Editor) => editor.chain().focus();

const blocks: Block[] = [
  ...([1, 2, 3] as const).map(
    (level): Block => ({
      id: `h${level}`,
      label: `見出し${level}`,
      keywords: [`h${level}`, "heading", "midashi", "#".repeat(level)],
      icon: <TitleIcon fontSize="small" />,
      run: (e) => chain(e).setHeading({ level }).run(),
    }),
  ),
  { id: "bullet", label: "箇条書き", keywords: ["list", "ul", "bullet", "-"], icon: <FormatListBulletedIcon fontSize="small" />, run: (e) => chain(e).toggleBulletList().run() },
  { id: "ordered", label: "番号つきリスト", keywords: ["list", "ol", "ordered", "number", "1."], icon: <FormatListNumberedIcon fontSize="small" />, run: (e) => chain(e).toggleOrderedList().run() },
  { id: "task", label: "チェックリスト", keywords: ["todo", "task", "check", "[]"], icon: <ChecklistIcon fontSize="small" />, run: (e) => chain(e).toggleTaskList().run() },
  { id: "quote", label: "引用", keywords: ["quote", "blockquote", ">"], icon: <FormatQuoteIcon fontSize="small" />, run: (e) => chain(e).setBlockquote().run() },
  { id: "code", label: "コードブロック", keywords: ["code", "pre", "```"], icon: <DataObjectIcon fontSize="small" />, run: (e) => chain(e).setCodeBlock().run() },
  { id: "table", label: "表", keywords: ["table", "hyou"], icon: <TableChartOutlinedIcon fontSize="small" />, run: (e) => chain(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  {
    id: "image",
    label: "画像",
    keywords: ["image", "img", "picture", "gazou"],
    icon: <ImageOutlinedIcon fontSize="small" />,
    run: (e) => {
      const src = prompt("画像のURL");
      if (src?.trim()) chain(e).setImage({ src: src.trim() }).run();
      else e.commands.focus();
    },
  },
  { id: "hr", label: "区切り線", keywords: ["hr", "divider", "line", "---"], icon: <HorizontalRuleIcon fontSize="small" />, run: (e) => chain(e).setHorizontalRule().run() },
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
  return (
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
        b.run(editor);
      }}
    />
  );
}
