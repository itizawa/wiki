import Box from "@mui/material/Box";
import ListItemText from "@mui/material/ListItemText";
import type { Editor } from "@tiptap/react";
import { searchEmoji } from "../lib/emoji";
import { createTrigger, TriggerMenu, useTriggerMatch, type FindTrigger } from "./trigger";

const MAX_ITEMS = 8;

/**
 * 行頭か空白の直後の「:」から、カーソルまで。続けて文字・数字・「_」を1文字以上打ったときだけ当てる
 * （「:」だけ、「:)」のような顔文字、「10:30」や URL の途中の「:」では出さない）。
 */
export const findEmoji: FindTrigger = (before) => {
  const m = /(?:^|\s):([\p{L}\p{N}_]+)$/u.exec(before);
  return m ? { index: before.length - m[1]!.length - 1, query: m[1]! } : null;
};

export const emojiTrigger = createTrigger("emojiMenu", findEmoji);

/**
 * 本文で「:」に続けて名前（`:memo`、`:メモ`）を打つと出る、絵文字の候補。選ぶと、打った文字を絵文字に置き換える。
 * 候補は、ページのアイコンと同じ一覧（`lib/emoji.ts`）。当たる絵文字が無ければ何も出さず、キーも受けない
 * （「:」のあとにふつうの語を書いているだけのことが多いため）。
 */
export function EmojiMenu({ editor }: { editor: Editor }) {
  const match = useTriggerMatch(editor, emojiTrigger);
  const items = match ? searchEmoji(match.query, MAX_ITEMS) : [];
  return (
    <TriggerMenu
      editor={editor}
      trigger={emojiTrigger}
      match={items.length > 0 ? match : null}
      items={items}
      itemKey={(e) => e.char}
      label="絵文字を挿入"
      emptyText=""
      renderItem={(e) => (
        <>
          <Box component="span" aria-hidden sx={{ width: 28, fontSize: "1.125rem", lineHeight: 1 }}>
            {e.char}
          </Box>
          <ListItemText>
            {e.keywords[0] ?? e.name}（:{e.name}）
          </ListItemText>
        </>
      )}
      onChoose={(e, range) => editor.chain().focus().deleteRange(range).insertContent(e.char).run()}
    />
  );
}
