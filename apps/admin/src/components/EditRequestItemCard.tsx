import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import type { EditRequest, EditRequestItem, EditRequestItemKind, EditRequestPerson, StaleReason } from "@wiki/shared";
import { ChevronDown, ChevronRight, MessageSquare, Replace } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { suggestionDiff, type DiffLine } from "../lib/editRequestDiff";
import { requesterLabel } from "../lib/editRequests";
import { formatDateTime } from "../lib/format";
import { pageLink } from "../lib/wiki";
import { monoFont, TOUCH } from "../theme";
import { EditRequestReplies } from "./EditRequestReplies";
import { RouterLink } from "./ui";

export { requesterLabel };

/** 項目の場所に出す、操作の結果（採用できなかった理由など）。 */
export type ItemNotice =
  /** 編集中の人の下書きで、元の文面が見つからなかった */
  | { kind: "draft_conflict"; editors: EditRequestPerson[] }
  /** 「すべて採用」で、先に採用した項目と行が重なった */
  | { kind: "overlap" }
  | { kind: "error"; message: string };

const STALE_TEXT: Record<StaleReason, string> = {
  not_found: "この箇所は、提案のあとに書き換えられたため、採用できません。",
  ambiguous: "提案のあとに本文が変わり、同じ文面が複数の箇所にあるため、どこを指していたか決められません。採用できません。",
};
const STALE_NOTE_TEXT: Record<StaleReason, string> = {
  not_found: "この箇所は、指摘のあとに書き換えられました。",
  ambiguous: "指摘のあとに本文が変わり、同じ文面が複数の箇所にあるため、どこを指していたか決められません。",
};

/** 種類の呼び方 */
export const KIND_LABEL: Record<EditRequestItemKind, string> = { suggestion: "提案", note: "指摘" };

function noticeText(notice: ItemNotice): string {
  if (notice.kind === "draft_conflict") {
    const who = notice.editors.length > 0 ? `${notice.editors.map((e) => e.name).join("、")} さん` : "ほかの人";
    return `${who}がこの箇所を編集中のため、採用を止めました。編集が版になるのを待つか、本人に確かめてから、もう一度採用してください。`;
  }
  if (notice.kind === "overlap") return "同じ行への別の提案を先に採用したため、この提案は採用しませんでした。";
  return notice.message;
}

/** 畳んだときに出す、中身の先頭の1行 */
function excerptOf(item: Pick<EditRequestItem, "kind" | "body" | "replacement">): string {
  if (item.kind === "note") return (item.body ?? "").split("\n").find((l) => l.trim() !== "") ?? "";
  if (item.replacement === "") return "（行を消す提案）";
  return (item.replacement ?? "").split("\n").find((l) => l.trim() !== "") ?? "";
}

/** 本文の中（引用やリストの中）に出しても、まわりの文字の見た目を引き継がないための土台。項目のカード・入力欄で同じものを使う */
export const cardBaseSx = {
  color: "text.primary",
  fontSize: "0.875rem",
  fontWeight: 400,
  fontStyle: "normal",
  lineHeight: 1.6,
  textAlign: "left",
  whiteSpace: "normal",
  bgcolor: "background.paper",
  borderRadius: 1,
  minWidth: 0,
} as const;

/**
 * 編集リクエストの項目1件：出した人・日時と、提案なら Markdown の行の差分・理由と採否の操作、指摘なら本文と「解決済みにする」。
 * その下に、返信の一覧と入力欄（`EditRequestReplies`）。
 *
 * 提案と指摘は、色に頼らずに見分けられるようにしてある：種類の印（アイコンと「提案」「指摘」の文字）、
 * 中身の形（提案は - / + の差分の箱、指摘は吹き出しの形の本文）、左の線（提案は実線、指摘は点線）。
 *
 * `collapsible` を渡すと、畳んだ1行（種類・出した人・中身の先頭・返信の数・状態）で出し、押すと開く。片付いた項目（採用・却下・解決済み・取り下げ）に使う。
 * 開けば、返信と入力欄まで出る。
 *
 * 本文（`.tiptap`）の中にも差し込むので、本文の見た目（段落・コード・リストなどのスタイル）が当たる要素（p / pre / code / ul …）は使わない。
 */
export function EditRequestItemCard(props: {
  pageId: string;
  request: Pick<EditRequest, "createdBy" | "via" | "createdAt">;
  item: EditRequestItem;
  /** 操作の結果。この項目の場所に出す */
  notice?: ItemNotice | null;
  /** この項目で、いま通信中の操作 */
  busy?: "accept" | "reject" | "resolve" | "reopen" | null;
  /** ほかの操作の通信中で、押せない */
  disabled?: boolean;
  /** 畳んだ1行で出し、押すと開く */
  collapsible?: boolean;
  /** 指している箇所の文面も出す（本文の、その箇所のすぐ下に出していないとき。指摘は、どこへの指摘かが分からなくなるので） */
  showOriginal?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onResolve?: () => void;
  onReopen?: () => void;
}) {
  const { item, request, notice, busy, disabled } = props;
  const note = item.kind === "note";
  const diff = useMemo(() => (item.replacement === null ? [] : suggestionDiff(item.originalText, item.replacement)), [item.originalText, item.replacement]);
  const open = item.status === "open";
  const stale = open ? item.stale : null;
  const who = requesterLabel(request);
  const about = `${who} の${KIND_LABEL[item.kind]}`;
  const decided = item.decidedBy && item.decidedAt ? `${item.decidedBy.name}・${formatDateTime(item.decidedAt)}` : null;
  const [expanded, setExpanded] = useState(!props.collapsible);
  const shown = !props.collapsible || expanded;
  const detailsId = useId();

  const header = (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25, minWidth: 0, flex: 1 }}>
      <KindChip kind={item.kind} />
      <Box component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
        {who}
      </Box>
      <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
        {formatDateTime(request.createdAt)} に{KIND_LABEL[item.kind]}
      </Box>
      <Box component="span" sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 1 }}>
        {/* 畳んでいるあいだも、返信があることは分かるようにする */}
        {!shown && item.comments.length > 0 && (
          <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
            返信 {item.comments.length} 件
          </Box>
        )}
        <StatusChip item={item} />
      </Box>
      {!shown && (
        <Box component="span" sx={{ flexBasis: "100%", color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {excerptOf(item)}
        </Box>
      )}
    </Box>
  );

  return (
    <Box
      component="section"
      aria-label={about}
      sx={{
        ...cardBaseSx,
        border: 1,
        borderColor: "divider",
        // 未対応の項目は、左の太い線で、本文の箇所とつながって見えるようにする。指摘は点線（色だけで見分けさせない）
        borderLeft: 3,
        borderLeftStyle: note ? "dotted" : "solid",
        borderLeftColor: open && (!stale || note) ? "primary.main" : "divider",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {props.collapsible ? (
        <ButtonBase
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          aria-label={`${about}（${STATUS_LABEL[item.status]}）を${expanded ? "畳む" : "開く"}`}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 0.75,
            width: "100%",
            p: 1.5,
            textAlign: "left",
            font: "inherit",
            borderRadius: 1,
            "&:hover": { bgcolor: "action.hover" },
            "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
            [TOUCH]: { minHeight: 48 },
          }}
        >
          {/* 開く・畳むの向きを、いつも出しておく（押せると分かるように） */}
          <Box component="span" aria-hidden sx={{ display: "inline-flex", pt: "3px", color: "text.secondary" }}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </Box>
          {header}
        </ButtonBase>
      ) : (
        <Box sx={{ p: 1.5, pb: 0, display: "flex" }}>{header}</Box>
      )}

      {shown && (
        <Box id={detailsId} sx={{ p: 1.5, pt: props.collapsible ? 0 : 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {note ? (
            <>
              {props.showOriginal && <QuotedOriginal text={item.originalText} />}
              <NoteBody text={item.body ?? ""} />
            </>
          ) : (
            <DiffBlock lines={diff} />
          )}

          {item.reason && (
            <Box sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              <Box component="span" sx={{ color: "text.secondary" }}>
                理由：
              </Box>
              {item.reason}
            </Box>
          )}

          {stale &&
            (note ? (
              <Alert severity="info" sx={{ py: 0 }}>
                {STALE_NOTE_TEXT[stale]}指摘した文面は、もう本文にありません。直っていれば、解決済みにしてください。
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ py: 0 }}>
                {STALE_TEXT[stale]}却下するか、出した人に出し直してもらってください。
              </Alert>
            ))}
          {notice && (
            <Alert severity={notice.kind === "error" ? "error" : "warning"} sx={{ py: 0 }}>
              {noticeText(notice)}
            </Alert>
          )}

          {open && !note && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
              {/* 古くなった項目は採用できない。理由は、すぐ上に出している */}
              <Button variant="contained" size="small" disabled={Boolean(stale) || disabled || !props.onAccept} loading={busy === "accept"} onClick={props.onAccept}>
                採用する
              </Button>
              <Button variant="outlined" size="small" disabled={disabled || !props.onReject} loading={busy === "reject"} onClick={props.onReject}>
                却下する
              </Button>
            </Box>
          )}
          {open && note && (
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
              {/* 古くなった指摘も、解決済みにできる。本文は変わらないので、塗りのボタンにはしない */}
              <Button variant="outlined" size="small" disabled={disabled || !props.onResolve} loading={busy === "resolve"} onClick={props.onResolve}>
                解決済みにする
              </Button>
              <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
                本文は変わりません。あとから未対応に戻せます。
              </Box>
            </Box>
          )}
          {item.status === "accepted" && (
            <Box sx={{ color: "text.secondary" }}>
              {decided ? `${decided} に採用しました。` : "採用しました。"}この箇所を置き換えた、新しい版ができています。取り消すときは、版履歴から前の版に戻します。
              {item.acceptedVersionId && (
                <>
                  {" "}
                  <RouterLink {...pageLink(props.pageId)} search={{ history: item.acceptedVersionId }}>
                    版履歴でこの版を見る
                  </RouterLink>
                </>
              )}
            </Box>
          )}
          {(item.status === "rejected" || item.status === "resolved") && (
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
              <Box component="span" sx={{ color: "text.secondary" }}>
                {item.status === "rejected" ? (decided ? `${decided} に却下しました。` : "却下しました。") : decided ? `${decided} に解決済みにしました。` : "解決済みにしました。"}
              </Box>
              {props.onReopen && (
                <Button variant="outlined" size="small" disabled={disabled} loading={busy === "reopen"} onClick={props.onReopen}>
                  未対応に戻す
                </Button>
              )}
            </Box>
          )}
          {item.status === "withdrawn" && <Box sx={{ color: "text.secondary" }}>{decided ? `${decided} に、出した人が取り下げました。` : "出した人が取り下げました。"}</Box>}

          <EditRequestReplies pageId={props.pageId} itemId={item.id} comments={item.comments} about={about} />
        </Box>
      )}
    </Box>
  );
}

const STATUS_LABEL: Record<EditRequestItem["status"], string> = { open: "未対応", accepted: "採用", rejected: "却下", resolved: "解決済み", withdrawn: "取り下げ" };

function StatusChip({ item }: { item: EditRequestItem }) {
  if (item.status === "open") return item.stale ? <Chip size="small" variant="outlined" color="warning" label="古くなった" /> : <Chip size="small" variant="outlined" color="primary" label="未対応" />;
  if (item.status === "accepted") return <Chip size="small" color="success" label="採用" />;
  if (item.status === "resolved") return <Chip size="small" variant="outlined" color="success" label="解決済み" />;
  if (item.status === "rejected") return <Chip size="small" label="却下" />;
  return <Chip size="small" variant="outlined" label="取り下げ" />;
}

/** 種類の印：アイコンと文字。提案は角ばった枠、指摘は丸い枠（色に頼らない） */
export function KindChip({ kind }: { kind: EditRequestItemKind }) {
  const note = kind === "note";
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        height: 22,
        fontSize: "0.75rem",
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: "text.primary",
        border: 1,
        borderColor: "text.secondary",
        borderStyle: note ? "dotted" : "solid",
        borderRadius: note ? "11px" : "4px",
      }}
    >
      {note ? <MessageSquare size={13} aria-hidden /> : <Replace size={13} aria-hidden />}
      {KIND_LABEL[kind]}
    </Box>
  );
}

/** 指摘の本文。プレーンテキストとして出す（改行は保つ）。吹き出しの形にして、差分の箱と見分ける */
export function NoteBody({ text }: { text: string }) {
  return (
    <Box
      role="group"
      aria-label="指摘の内容"
      sx={{ bgcolor: "action.hover", borderRadius: "2px 12px 12px 12px", px: 1.5, py: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.9375rem" }}
    >
      {text}
    </Box>
  );
}

/** 指している箇所の文面（Markdown のまま）。長ければ、先頭の数行だけ */
export function QuotedOriginal({ text }: { text: string }) {
  const lines = text.split("\n");
  const LIMIT = 4;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.8rem", mb: 0.25 }}>
        指している箇所
      </Box>
      <Box
        sx={{
          fontFamily: monoFont,
          fontSize: "0.8125rem",
          lineHeight: 1.6,
          color: "text.secondary",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          px: 1,
          py: 0.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {lines.slice(0, LIMIT).join("\n")}
        {lines.length > LIMIT && `\n…（ほか ${lines.length - LIMIT} 行）`}
      </Box>
    </Box>
  );
}

/** Markdown の行の差分。行の頭に - / + を付け、変わった語には背景色に加えて打消し線・下線を付ける（色だけに頼らない）。 */
export function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <Box
      role="group"
      aria-label="変更の内容"
      sx={{ fontFamily: monoFont, fontSize: "0.8125rem", lineHeight: 1.6, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}
    >
      {lines.map((line, i) => {
        const removed = line.kind === "removed";
        const added = line.kind === "added";
        return (
          <Box
            key={i}
            // 消える行・入る行は、読み上げでも分かる要素にする
            component={removed ? "del" : added ? "ins" : "div"}
            sx={{
              display: "flex",
              textDecoration: "none",
              bgcolor: removed ? "diff.removed" : added ? "diff.added" : undefined,
              color: removed || added ? "text.primary" : "text.secondary",
            }}
          >
            <Box component="span" aria-hidden sx={{ flex: "0 0 1.75em", textAlign: "center", userSelect: "none", fontWeight: 700 }}>
              {removed ? "-" : added ? "+" : " "}
            </Box>
            <Box component="span" sx={{ flex: 1, minWidth: 0, pr: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {line.segments.length === 0 ? (
                // 空行。高さを保ち、空行だと分かるようにする
                <Box component="span" sx={{ color: "text.disabled" }}>
                  （空行）
                </Box>
              ) : (
                line.segments.map((s, k) =>
                  s.changed ? (
                    <Box
                      key={k}
                      component="span"
                      sx={{
                        fontWeight: 700,
                        textDecoration: removed ? "line-through" : "underline",
                        textDecorationThickness: "2px",
                        textUnderlineOffset: "2px",
                        bgcolor: removed ? "diff.removedStrong" : "diff.addedStrong",
                        borderRadius: "2px",
                      }}
                    >
                      {s.text}
                    </Box>
                  ) : (
                    s.text
                  ),
                )
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
