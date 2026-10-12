import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EDIT_REQUEST_LIMITS, type EditRequestComment } from "@wiki/shared";
import { useId, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { invalidateEditRequests, requesterLabel } from "../lib/editRequests";
import { formatDateTime } from "../lib/format";
import { TOUCH } from "../theme";

/**
 * 編集リクエストの項目への返信：これまでの返信（古い順）と、入力欄。
 *
 * - 本文は**プレーンテキスト**として出す（HTML としても Markdown としても描かない。改行は保つ。URL もリンクにしない。
 *   リクエストのひとこと・提案の理由と同じ出し方）
 * - 書いた人は、項目を出した人と同じ決まり（外部のアプリからは「アプリ名・許可した人」。`requesterLabel`）
 * - 入力欄は、ホバーしなくても見える。送ると、そのページの一覧を読み直す（`invalidateEditRequests`）
 * - 項目の状態は問わない（採用・却下・解決済み・取り下げのあとも書ける）。書いた返信は、書き換えも削除もできない
 *
 * 本文（`.tiptap`）の中にも差し込むので、本文の見た目が当たる要素（p / ul / li / blockquote …）は使わない。
 */
export function EditRequestReplies(props: {
  pageId: string;
  itemId: string;
  comments: readonly EditRequestComment[];
  /** 入力欄の名前に添える、項目の呼び方（「Claude・佐藤 の指摘」など。読み上げで、どの項目への返信か分かるように） */
  about: string;
}) {
  const { pageId, itemId, comments } = props;
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const helpId = useId();
  const send = useMutation({
    mutationFn: (body: string) => api.replyToEditRequestItem(pageId, itemId, body),
    onSuccess: async () => {
      // 一覧に出てから、入力欄を空にする（送ったものが、いちど消えて見えないように）
      await invalidateEditRequests(qc, pageId);
      setText("");
    },
  });
  const body = text.trim();
  const tooLong = body.length > EDIT_REQUEST_LIMITS.reply;
  const submit = () => {
    if (body !== "" && !tooLong && !send.isPending) send.mutate(body);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, borderTop: 1, borderColor: "divider", pt: 1 }}>
      {comments.length > 0 && (
        <Box role="list" aria-label={`${props.about}への返信`} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {comments.map((c) => (
            // 左の線と字下げで、項目の本文と見分ける（色だけに頼らない）
            <Box key={c.id} role="listitem" sx={{ pl: 1.25, borderLeft: 2, borderColor: "divider", minWidth: 0 }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 1 }}>
                <Box component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                  {requesterLabel(c)}
                </Box>
                <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
                  {formatDateTime(c.createdAt)}
                </Box>
              </Box>
              <Box sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.body}</Box>
            </Box>
          ))}
        </Box>
      )}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1 }}
      >
        <TextField
          label="返信"
          placeholder="例：出典が分かれば、教えてください"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (send.isError) send.reset();
          }}
          onKeyDown={(e) => {
            // ⌘ / Ctrl + Enter でも送れる（Enter だけでは改行）
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          multiline
          minRows={1}
          maxRows={8}
          size="small"
          disabled={send.isPending}
          error={tooLong}
          sx={{ flex: "1 1 240px", minWidth: 0 }}
          slotProps={{
            htmlInput: { "aria-label": `${props.about}に返信する`, "aria-describedby": helpId },
            inputLabel: { shrink: true },
          }}
        />
        <Button type="submit" variant="outlined" size="small" disabled={body === "" || tooLong} loading={send.isPending} sx={{ mt: "3px", whiteSpace: "nowrap", [TOUCH]: { minHeight: 40, mt: 0 } }}>
          返信する
        </Button>
        {/* 条件は、送る前から出しておく（書きはじめたら出す。並ぶ項目ごとに、いつも出すと読みにくい） */}
        <Box id={helpId} sx={{ flexBasis: "100%", fontSize: "0.8rem", color: tooLong ? "error.main" : "text.secondary", display: text === "" ? "none" : "block" }}>
          {tooLong
            ? `返信が長すぎます（${body.length.toLocaleString()} / ${EDIT_REQUEST_LIMITS.reply.toLocaleString()} 字）。短くするか、分けて送ってください。`
            : "書いたままの文字で送られます（Markdown の記法は、そのまま出ます）。送ったあとは、書き換えも削除もできません。"}
        </Box>
      </Box>
      {send.isError && (
        <Alert severity="error" sx={{ py: 0 }}>
          返信を送れませんでした。{errorMessage(send.error)}書いた内容は、入力欄に残っています。
        </Alert>
      )}
    </Box>
  );
}
