import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import type { EditRequest, EditRequestItem, EditRequestPerson, StaleReason } from "@wiki/shared";
import { useMemo } from "react";
import { suggestionDiff, type DiffLine } from "../lib/editRequestDiff";
import { formatDateTime } from "../lib/format";
import { pageLink } from "../lib/wiki";
import { monoFont, TOUCH } from "../theme";
import { RouterLink } from "./ui";

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

/** 出した人の表示。外部のアプリ（MCP）から出したものは「アプリ名・許可した人」 */
export const requesterLabel = (request: Pick<EditRequest, "createdBy" | "via">) =>
  request.via ? `${request.via}・${request.createdBy.name}` : request.createdBy.name;

function noticeText(notice: ItemNotice): string {
  if (notice.kind === "draft_conflict") {
    const who = notice.editors.length > 0 ? `${notice.editors.map((e) => e.name).join("、")} さん` : "ほかの人";
    return `${who}がこの箇所を編集中のため、採用を止めました。編集が版になるのを待つか、本人に確かめてから、もう一度採用してください。`;
  }
  if (notice.kind === "overlap") return "同じ行への別の提案を先に採用したため、この提案は採用しませんでした。";
  return notice.message;
}

/**
 * 編集リクエストの項目1件：出した人・日時・Markdown の行の差分・理由と、採否の操作。
 * 本文（`.tiptap`）の中にも差し込むので、本文の見た目（段落・コード・リストなどのスタイル）が当たる要素（p / pre / code / ul …）は使わない。
 */
export function EditRequestItemCard(props: {
  pageId: string;
  request: Pick<EditRequest, "createdBy" | "via" | "createdAt">;
  item: EditRequestItem;
  /** 操作の結果。この項目の場所に出す */
  notice?: ItemNotice | null;
  /** この項目で、いま通信中の操作 */
  busy?: "accept" | "reject" | "reopen" | null;
  /** ほかの操作の通信中で、押せない */
  disabled?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onReopen?: () => void;
}) {
  const { item, request, notice, busy, disabled } = props;
  const diff = useMemo(() => suggestionDiff(item.originalText, item.replacement), [item.originalText, item.replacement]);
  const open = item.status === "open";
  const stale = open ? item.stale : null;
  const who = requesterLabel(request);
  const decided = item.decidedBy && item.decidedAt ? `${item.decidedBy.name}・${formatDateTime(item.decidedAt)}` : null;

  return (
    <Box
      component="section"
      aria-label={`${who} の提案`}
      sx={{
        // 本文の中（引用やリストの中）に出しても、まわりの文字の見た目を引き継がない
        color: "text.primary",
        fontSize: "0.875rem",
        fontWeight: 400,
        fontStyle: "normal",
        lineHeight: 1.6,
        textAlign: "left",
        whiteSpace: "normal",
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        // 未対応の項目は、左の太い線で、本文の箇所とつながって見えるようにする
        borderLeft: 3,
        borderLeftColor: open && !stale ? "primary.main" : "divider",
        borderRadius: 1,
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25 }}>
        <Box component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {who}
        </Box>
        <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
          {formatDateTime(request.createdAt)} に提案
        </Box>
        <Box component="span" sx={{ ml: "auto" }}>
          <StatusChip item={item} />
        </Box>
      </Box>

      <DiffBlock lines={diff} />

      {item.reason && (
        <Box sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          <Box component="span" sx={{ color: "text.secondary" }}>
            理由：
          </Box>
          {item.reason}
        </Box>
      )}

      {stale && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {STALE_TEXT[stale]}却下するか、出した人に出し直してもらってください。
        </Alert>
      )}
      {notice && (
        <Alert severity={notice.kind === "error" ? "error" : "warning"} sx={{ py: 0 }}>
          {noticeText(notice)}
        </Alert>
      )}

      {open && (
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
      {item.status === "rejected" && (
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {decided ? `${decided} に却下しました。` : "却下しました。"}
          </Box>
          {props.onReopen && (
            <Button variant="outlined" size="small" disabled={disabled} loading={busy === "reopen"} onClick={props.onReopen}>
              未対応に戻す
            </Button>
          )}
        </Box>
      )}
      {item.status === "withdrawn" && <Box sx={{ color: "text.secondary" }}>{decided ? `${decided} に、出した人が取り下げました。` : "出した人が取り下げました。"}</Box>}
    </Box>
  );
}

function StatusChip({ item }: { item: EditRequestItem }) {
  if (item.status === "open") return item.stale ? <Chip size="small" variant="outlined" color="warning" label="古くなった" /> : <Chip size="small" variant="outlined" color="primary" label="未対応" />;
  if (item.status === "accepted") return <Chip size="small" color="success" label="採用" />;
  if (item.status === "rejected") return <Chip size="small" label="却下" />;
  return <Chip size="small" variant="outlined" label="取り下げ" />;
}

/** Markdown の行の差分。行の頭に - / + を付け、変わった語には背景色に加えて打消し線・下線を付ける（色だけに頼らない）。 */
function DiffBlock({ lines }: { lines: DiffLine[] }) {
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
