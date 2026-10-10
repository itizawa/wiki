import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { confirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isoToJstLocal, jstLocalToIso, pagePath, unlistedPath, type PageDetail, type PublishVisibility, type ScheduledAction } from "@wiki/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Mono, Muted, Row, Section, StatusChip } from "./ui";

const statusLabel: Record<ScheduledAction["status"], string> = {
  scheduled: "予約中",
  running: "実行中",
  done: "実行済み",
  failed: "失敗",
  canceled: "取り消し済み",
};

export const actionLabel = (a: Pick<ScheduledAction, "actionType" | "targetVisibility">) =>
  a.actionType === "publish_page"
    ? a.targetVisibility === "unlisted"
      ? "限定公開"
      : "公開"
    : a.actionType === "unpublish_page"
      ? "非公開化"
      : "マージ";

/** エディタ横の公開設定：公開/非公開化、限定公開URL、予約。 */
export function PublishPanel({ page, dirty }: { page: PageDetail; dirty: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: Infinity });
  const schedule = useQuery({ queryKey: ["schedule", page.id], queryFn: () => api.listSchedule({ pageId: page.id }) });
  const [visibility, setVisibility] = useState<PublishVisibility>(page.visibility === "unlisted" ? "unlisted" : "public");
  const [runAt, setRunAt] = useState(() => isoToJstLocal(new Date(Date.now() + 24 * 3600_000).toISOString()).slice(0, 11) + "07:00");
  const [scheduleKind, setScheduleKind] = useState<"publish_page" | "unpublish_page">("publish_page");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["page", page.id] });
    await qc.invalidateQueries({ queryKey: ["schedule"] });
    await qc.invalidateQueries({ queryKey: ["pages"] });
  };
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  const published = page.publishedVersionId !== null && page.visibility !== "private";
  const origin = settings.data?.siteOrigin ?? "";
  const url =
    page.visibility === "public"
      ? origin + pagePath(page.id)
      : page.visibility === "unlisted" && page.unlistedKey
        ? origin + unlistedPath(page.unlistedKey)
        : null;
  const pending = (schedule.data?.actions ?? []).filter((a) => a.status === "scheduled" || a.status === "failed" || a.status === "running");

  // 無効なボタンはホバーを受けないので、理由は外側の span に出す
  const needsSave = dirty ? "先に保存してください" : "";

  return (
    <Section>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h3">
          公開
        </Typography>
        <Stack spacing={0.75} sx={{ alignItems: "flex-start" }}>
          {!published && <StatusChip label="非公開" />}
          {published && page.visibility === "public" && <StatusChip status="public" label="公開中" />}
          {published && page.visibility === "unlisted" && <StatusChip status="unlisted" label="限定公開中" />}
          {published && page.publishedVersionId !== page.headVersionId && (
            <Muted>公開版より新しい編集があります。反映するにはもう一度公開してください。</Muted>
          )}
          {published && url && (
            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
              <Link href={url} target="_blank" rel="noreferrer">
                <Mono>{url}</Mono>
              </Link>
            </Typography>
          )}
          {published && page.visibility === "unlisted" && (
            <Alert severity="warning">このページはURLを知る人が閲覧できます。機密情報は載せないでください。</Alert>
          )}
          {published && <Muted>サイトへの反映は数分後（ビルド後）です。</Muted>}
        </Stack>

        <Row>
          <TextField select value={visibility} onChange={(e) => setVisibility(e.target.value as PublishVisibility)} sx={{ flex: 1, minWidth: 0 }}>
            <MenuItem value="public">公開</MenuItem>
            <MenuItem value="unlisted">限定公開（URLを知る人のみ）</MenuItem>
          </TextField>
          <Tooltip title={needsSave}>
            <span>
              <Button
                variant="contained"
                size="medium"
                disabled={dirty || action.isPending}
                onClick={() => action.mutate(() => api.publish(page.id, { versionId: page.headVersionId, visibility }))}
              >
                {published ? "最新版で公開し直す" : "今すぐ公開"}
              </Button>
            </span>
          </Tooltip>
        </Row>
        {published && (
          <Row>
            <Button
              variant="outlined"
              disabled={action.isPending}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "このページを非公開にしますか？",
                  body: "公開サイトから見られなくなります（反映は数分後、ビルドのあとです）。あとでもう一度公開できます。",
                  confirmLabel: "非公開にする",
                  cancelLabel: "公開したままにする",
                });
                if (ok) action.mutate(() => api.unpublish(page.id));
              }}
            >
              非公開にする…
            </Button>
            {page.visibility === "unlisted" && (
              <Button
                variant="outlined"
                disabled={action.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "限定公開URLを再発行しますか？",
                    body: "いまのURLは、次のビルドのあと見られなくなります。すでに伝えた相手には、新しいURLを伝え直す必要があります。",
                    confirmLabel: "URLを再発行する",
                    cancelLabel: "いまのURLのままにする",
                    danger: true,
                  });
                  if (ok) action.mutate(() => api.rotateUnlistedKey(page.id));
                }}
              >
                URLを再発行…
              </Button>
            )}
          </Row>
        )}

        <Typography variant="subtitle1" component="h3">
          予約
        </Typography>
        <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
          <TextField select fullWidth value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value as typeof scheduleKind)}>
            <MenuItem value="publish_page">{visibility === "unlisted" ? "限定公開" : "公開"}を予約</MenuItem>
            <MenuItem value="unpublish_page">非公開化を予約</MenuItem>
          </TextField>
          <TextField type="datetime-local" label="日時（JST）" fullWidth value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          <Tooltip title={needsSave}>
            <span>
              <Button
                variant="outlined"
                disabled={dirty || action.isPending || !runAt}
                onClick={() =>
                  action.mutate(() =>
                    api.createSchedule(
                      scheduleKind === "publish_page"
                        ? { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, targetVisibility: visibility, runAt: jstLocalToIso(runAt) }
                        : { actionType: "unpublish_page", pageId: page.id, runAt: jstLocalToIso(runAt) },
                    ),
                  )
                }
              >
                予約する
              </Button>
            </span>
          </Tooltip>
          <Muted>予約時点の版が公開されます。予約後の編集は含まれません。反映は予約時刻から数分以内です。</Muted>
        </Stack>
        {action.error && <Alert severity="error">{errorMessage(action.error)}</Alert>}

        {pending.length > 0 && (
          <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {pending.map((a) => (
              <Stack component="li" key={a.id} spacing={0.5}>
                <Row>
                  <StatusChip status={a.status} label={statusLabel[a.status]} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    {formatDateTime(a.runAt)} に{actionLabel(a)}
                  </Typography>
                  {(a.status === "scheduled" || a.status === "failed") && (
                    <Button variant="text" color="error" onClick={() => action.mutate(() => api.cancelSchedule(a.id))}>
                      予約を取り消す
                    </Button>
                  )}
                </Row>
                {a.editedAfterSchedule && (
                  <Typography variant="body2" color="warning.main">
                    予約後に編集があります（予約内容には反映されません。反映するなら予約し直してください）
                  </Typography>
                )}
                {a.lastError && (
                  <Typography variant="body2" color="error">
                    {a.lastError}（{a.attempts}回試行）
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}
