import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import { SmilePlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { normalizePageIcon, type PageDetail } from "@wiki/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { EMOJI_GROUPS, searchEmoji, type Emoji } from "../lib/emoji";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

/** タイトルの左の余白に置くボタンの大きさ。余白（広い画面で 32px）に収める */
const GUTTER_BUTTON = 28;

/**
 * 編集画面の、ページのアイコンのボタン。押すと、アイコンを選ぶ画面を開く。
 * タイトルと本文の左端は揃えたままにしたいので、タイトルの横には並べない。
 * - 広い画面：タイトルの1行目の左の余白に置く。付いていないあいだも、付けるためのボタンとして出しておく
 * - 狭い画面（余白が足りない）：付いていればタイトルの上に出す。付いていなければ出さず、「…」メニューから付ける
 * タイトルを包む `position: relative` の要素の中に置く。
 */
export function PageIconButton({ icon, onClick }: { icon: string | null; onClick: () => void }) {
  const label = icon ? "アイコンを変える" : "アイコンを付ける";
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={icon ? `${label}（いまは ${icon}）` : label}
        aria-haspopup="dialog"
        onClick={onClick}
        sx={{
          display: { xs: icon ? "inline-flex" : "none", md: "inline-flex" },
          borderRadius: 1,
          lineHeight: 1,
          color: "text.secondary",
          "&:hover, &.Mui-focusVisible": { bgcolor: "action.hover" },
          // 狭い画面：絵文字の左端を、タイトルの左端に合わせる
          fontSize: { xs: "2rem", md: "1.375rem" },
          p: { xs: 0.5, md: 0 },
          ml: { xs: -0.5, md: 0 },
          mb: { xs: 0.5, md: 0 },
          // 広い画面：タイトルの1行目（2.25rem × 1.25）の高さの中央に置く
          position: { md: "absolute" },
          left: { md: -(GUTTER_BUTTON + 4) },
          top: { md: `calc((2.25rem * 1.25 - ${GUTTER_BUTTON}px) / 2)` },
          width: { md: GUTTER_BUTTON },
          height: { md: GUTTER_BUTTON },
        }}
      >
        {icon ?? <SmilePlus size={18} />}
      </ButtonBase>
    </Tooltip>
  );
}

/** 一覧の絵文字1つのボタンの大きさ（押しやすいよう、絵文字より広く取る） */
const CELL = 36;

/** 絵文字の読み上げとツールチップの名前（日本語の語があればそれを、無ければ英語の名前を使う）。 */
const emojiLabel = (e: Emoji) => e.keywords[0] ?? e.name;

function EmojiGrid(props: { emojis: Emoji[]; current: string | null; disabled: boolean; onChoose: (char: string) => void }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${CELL}px)` }}>
      {props.emojis.map((e) => (
        <ButtonBase
          key={e.char}
          title={emojiLabel(e)}
          aria-label={emojiLabel(e)}
          // いま付いているアイコンは、枠でも示す（色だけに頼らない）
          aria-pressed={e.char === props.current}
          disabled={props.disabled}
          onClick={() => props.onChoose(e.char)}
          sx={{
            width: CELL,
            height: CELL,
            fontSize: "1.375rem",
            borderRadius: 1,
            "&:hover, &.Mui-focusVisible": { bgcolor: "action.hover" },
            "&[aria-pressed='true']": { outline: 2, outlineColor: "primary.main", outlineOffset: -2, bgcolor: "action.selected" },
          }}
        >
          {e.char}
        </ButtonBase>
      ))}
    </Box>
  );
}

/**
 * ページのアイコン（絵文字1つ）を選ぶ。選ぶとすぐに保存する（本文の保存や版とは別）。
 * 一覧から選ぶか、入力欄に絵文字を直接入れる（一覧に無い絵文字は、OS の絵文字パネルなどから入れる）。
 * 入力欄は、一覧の絞り込みも兼ねる。
 */
export function PageIconPicker(props: { pageId: string; icon: string | null; anchorEl: HTMLElement | null; open: boolean; onClose: () => void }) {
  const { pageId, icon, open, onClose } = props;
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const save = useMutation({
    mutationFn: (next: string | null) => api.setPageIcon(pageId, next),
    onSuccess: (page) => {
      // 編集中の内容や版には触れず、アイコンだけを入れ替える
      qc.setQueryData<PageDetail>(["page", pageId], (old) => (old ? { ...old, icon: page.icon } : old));
      void qc.invalidateQueries({ queryKey: ["pages"] });
      // サイドバーのツリー・スターの行にも絵文字を出すので、取り直す
      void qc.invalidateQueries({ queryKey: ["structure"] });
      onClose();
    },
  });

  // 開くたびに、前の入力とエラーを残さない
  useEffect(() => {
    if (open) {
      setText("");
      save.reset();
    }
  }, [open]);

  const query = text.trim();
  /** 入力欄の文字そのものが絵文字1つなら、それをアイコンにできる */
  const typed = normalizePageIcon(query);
  const found = typed === null ? searchEmoji(query) : [];
  const choose = (next: string | null) => {
    if (next === icon) onClose();
    else save.mutate(next);
  };

  return (
    <Popover
      open={open}
      anchorEl={props.anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{ paper: { role: "dialog", "aria-label": "ページのアイコンを選ぶ", sx: { width: 344, maxWidth: "calc(100vw - 32px)", mt: 0.5 } } }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          fullWidth
          autoFocus
          label="絵文字を探す・入れる"
          placeholder="例：メモ、idea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 日本語の変換を確定する Enter では決めない
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
            const first = typed ?? found[0]?.char;
            if (first) choose(first);
          }}
          helperText="一覧に無い絵文字は、ここに1つ入れると選べます（絵文字パネル：Mac は ⌃⌘Space、Windows は Win + .）"
        />
      </Box>
      {save.error && (
        <Alert severity="error" sx={{ mx: 1.5, mb: 1 }}>
          アイコンを保存できませんでした：{errorMessage(save.error)}
        </Alert>
      )}
      <Box sx={{ px: 1.5, pb: 1, maxHeight: 264, overflowY: "auto" }}>
        {typed !== null ? (
          <Button fullWidth variant="outlined" disabled={save.isPending} onClick={() => choose(typed)} sx={{ justifyContent: "flex-start", gap: 1 }}>
            <Box component="span" aria-hidden sx={{ fontSize: "1.375rem", lineHeight: 1 }}>
              {typed}
            </Box>
            この絵文字をアイコンにする
          </Button>
        ) : query !== "" ? (
          found.length > 0 ? (
            <EmojiGrid emojis={found} current={icon} disabled={save.isPending} onChoose={choose} />
          ) : (
            <Muted sx={{ py: 1 }}>「{query}」に当たる絵文字は一覧にありません。使いたい絵文字を1つ、上の欄に入れてください。</Muted>
          )
        ) : (
          EMOJI_GROUPS.map((g) => (
            <Box key={g.label} component="section" aria-label={g.label} sx={{ mb: 1 }}>
              <Muted sx={{ fontSize: "0.75rem", mb: 0.25 }}>{g.label}</Muted>
              <EmojiGrid emojis={g.emojis} current={icon} disabled={save.isPending} onChoose={choose} />
            </Box>
          ))
        )}
      </Box>
      {icon !== null && (
        <Box sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}>
          {/* 外しても、また付け直せるので、赤にはしない */}
          <Button size="small" color="inherit" disabled={save.isPending} onClick={() => choose(null)}>
            アイコンを外す
          </Button>
        </Box>
      )}
    </Popover>
  );
}
