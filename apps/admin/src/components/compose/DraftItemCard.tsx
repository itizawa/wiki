import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import type { StaleReason } from "@wiki/shared";
import { useMemo } from "react";
import { suggestionDiff } from "../../lib/editRequestDiff";
import type { DraftItem } from "../../lib/editRequestDraft";
import { TOUCH } from "../../theme";
import { DiffBlock, KindChip, NoteBody, QuotedOriginal } from "../EditRequestItemCard";

const LOST_TEXT: Record<StaleReason, string> = {
  not_found: "新しい版では、この箇所が書き換えられていて、場所が見つかりません。このままでは送信できません。",
  ambiguous: "新しい版では、同じ文面が複数の箇所にあり、どこを指していたか決められません。このままでは送信できません。",
};

/**
 * 送信前の項目1件：提案なら差分・理由、指摘なら本文と、「直す」「取り除く」。送ったあとの項目（`EditRequestItemCard`）と同じ見た目にする
 * （種類の印、差分の箱、指摘の吹き出し）。
 * 本文（`.tiptap`）の中にも差し込むので、本文の見た目が当たる要素（p / pre / code / ul …）は使わない。
 */
export function DraftItemCard(props: {
  item: DraftItem;
  /** 何件目か（送信前の一覧で、本文の上から数えた番号） */
  index?: number;
  disabled?: boolean;
  /** 場所を決められなくなった項目は、直せない（選び直して、書き直す） */
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const { item } = props;
  const note = item.kind === "note";
  const replacement = item.kind === "suggestion" ? item.replacement : null;
  const diff = useMemo(() => (replacement === null ? [] : suggestionDiff(item.originalText, replacement)), [item.originalText, replacement]);
  const name = note ? "指摘" : "提案";
  return (
    <Box
      component="section"
      aria-label={props.index === undefined ? `送信前の${name}` : `送信前の${name} ${props.index} 件目`}
      sx={{
        color: "text.primary",
        fontSize: "0.875rem",
        fontWeight: 400,
        fontStyle: "normal",
        lineHeight: 1.6,
        textAlign: "left",
        whiteSpace: "normal",
        cursor: "auto",
        bgcolor: "background.paper",
        border: 1,
        // 送信前のものは、破線の枠で、送ったあとの提案と見分けられるようにする（色だけに頼らない）
        borderStyle: "dashed",
        borderColor: item.lost ? "warning.main" : "primary.main",
        borderRadius: 1,
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25 }}>
        <KindChip kind={item.kind} />
        <Box component="span" sx={{ fontWeight: 600 }}>
          {props.index === undefined ? `あなたの${name}` : `${props.index} 件目`}
        </Box>
        <Box component="span" sx={{ ml: "auto" }}>
          {item.lost ? <Chip size="small" variant="outlined" color="warning" label="場所が見つからない" /> : <Chip size="small" variant="outlined" color="primary" label="送信前" />}
        </Box>
      </Box>

      {item.kind === "note" ? (
        <>
          {/* 本文の箇所のすぐ下に出していないとき（送信前の一覧、場所が見つからないとき）は、どこへの指摘かも出す */}
          {(props.index !== undefined || item.lost) && <QuotedOriginal text={item.originalText} />}
          <NoteBody text={item.body} />
        </>
      ) : (
        <DiffBlock lines={diff} />
      )}

      {item.kind === "suggestion" && item.reason && (
        <Box sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          <Box component="span" sx={{ color: "text.secondary" }}>
            理由：
          </Box>
          {item.reason}
        </Box>
      )}

      {item.lost && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {LOST_TEXT[item.lost]}書いた内容は、上に残っています。本文で箇所を選び直して書き直してから、この{name}を取り除いてください。
        </Alert>
      )}

      {/* 取り除くと書いた内容が消えるので、「直す」から離して置く */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
        {props.onEdit && (
          <Button variant="outlined" size="small" disabled={props.disabled} onClick={props.onEdit}>
            直す
          </Button>
        )}
        <Button variant="text" size="small" color="error" disabled={props.disabled} onClick={props.onRemove} sx={{ ml: props.onEdit ? "auto" : 0 }}>
          取り除く
        </Button>
      </Box>
    </Box>
  );
}
