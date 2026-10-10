import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { confirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isoToJstLocal,
  isWithinParent,
  jstLocalToIso,
  type PageDetail,
  type PublishVisibility,
  type ScheduledAction,
} from "@wiki/shared";
import { useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useWiki } from "../lib/wiki";
import { formatDateTime } from "../lib/format";
import { publicPageUrl } from "../lib/publicUrl";
import { descendantImpact, pageHierarchy } from "../lib/visibility";
import { visibilityLabel } from "../routes/PagesPage";
import { Mono, Muted, Row, StatusChip } from "./ui";

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

/**
 * まだ版になっていない変更があれば、いまの内容を版にしてから、その版を持つページを返す（無ければ、いまのページをそのまま返す）。
 * 版を作れなかったら例外を投げる（公開・予約は行わない）。
 */
export type EnsureVersion = () => Promise<PageDetail>;

/**
 * 公開の設定：公開/非公開化、限定公開URL、予約。編集画面の「公開」ポップオーバーの中に出す。
 * 公開と予約は版に対して行う。まだ版になっていない変更（`dirty`）があれば、押したときにいまの内容を版にし、その版を使う。
 */
export function PublishPanel({ page, dirty, ensureVersion }: { page: PageDetail; dirty: boolean; ensureVersion: EnsureVersion }) {
  const qc = useQueryClient();
  const schedule = useQuery({ queryKey: ["schedule", page.id], queryFn: () => api.listSchedule({ pageId: page.id }) });
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const [picked, setVisibility] = useState<PublishVisibility>(page.visibility === "unlisted" ? "unlisted" : "public");
  const [applyToDescendants, setApplyToDescendants] = useState(false);
  const [runAt, setRunAt] = useState(() => isoToJstLocal(new Date(Date.now() + 24 * 3600_000).toISOString()).slice(0, 11) + "07:00");
  const [scheduleKind, setScheduleKind] = useState<"publish_page" | "unpublish_page">("publish_page");

  // 配下のページには、親と同じか、より狭い公開範囲しか設定できない
  const { parent, descendants } = useMemo(() => pageHierarchy(structure.data, page.id), [structure.data, page.id]);
  const canPick = (v: PublishVisibility) => isWithinParent(v, parent?.visibility ?? null);
  const parentReason = parent ? `親ページが${visibilityLabel[parent.visibility]}のため` : "";
  const visibility: PublishVisibility = canPick(picked) ? picked : "unlisted";
  const blockedByParent = !canPick("unlisted");
  const impact = descendantImpact(descendants, visibility);
  const publishedDescendants = descendants.filter((d) => d.published).length;
  const blockedByDescendants = impact.wider > 0 && !applyToDescendants;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["page", page.id] });
    await qc.invalidateQueries({ queryKey: ["structure"] });
    await qc.invalidateQueries({ queryKey: ["schedule"] });
    await qc.invalidateQueries({ queryKey: ["pages"] });
  };
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  const published = page.publishedVersionId !== null && page.visibility !== "private";
  // 公開 URL は wiki ごとのサブドメイン
  const { origin } = useWiki().wiki;
  const url = publicPageUrl(origin, page);
  const pending = (schedule.data?.actions ?? []).filter((a) => a.status === "scheduled" || a.status === "failed" || a.status === "running");

  return (
    <Box component="section" aria-label="公開">
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

        {blockedByParent && parent && (
          <Alert severity="info">
            親ページ「{parent.title}」が非公開のため、このページは公開できません。先に親ページを公開してください。
          </Alert>
        )}
        <Row>
          <TextField
            select
            value={visibility}
            disabled={blockedByParent}
            onChange={(e) => setVisibility(e.target.value as PublishVisibility)}
            sx={{ flex: 1, minWidth: 0 }}
          >
            <MenuItem value="public" disabled={!canPick("public")}>
              公開{!canPick("public") && `（${parentReason}選べません）`}
            </MenuItem>
            <MenuItem value="unlisted" disabled={!canPick("unlisted")}>
              限定公開（URLを知る人のみ）{!canPick("unlisted") && `（${parentReason}選べません）`}
            </MenuItem>
          </TextField>
          {/* 無効なボタンはホバーを受けないので、理由は外側の span に出す */}
          <Tooltip title={blockedByParent ? `${parentReason}公開できません` : ""}>
            <span>
              <Button
                variant="contained"
                size="medium"
                disabled={action.isPending || blockedByParent || blockedByDescendants}
                onClick={async () => {
                  if (applyToDescendants && impact.changed > 0) {
                    const ok = await confirmDialog({
                      title: "配下のページもまとめて変えますか？",
                      body: `このページと、配下の公開中のページ ${impact.changed} 件を「${visibilityLabel[visibility]}」にします。まだ公開していない配下のページは非公開のままです。あとから、それぞれのページで個別に変えられます。`,
                      confirmLabel: `${impact.changed + 1} 件を${visibilityLabel[visibility]}にする`,
                      cancelLabel: "やめる",
                    });
                    if (!ok) return;
                  }
                  action.mutate(async () => api.publish(page.id, { versionId: (await ensureVersion()).headVersionId, visibility, applyToDescendants }));
                }}
              >
                {published ? (dirty ? "いまの内容で公開し直す" : "最新版で公開し直す") : "今すぐ公開"}
              </Button>
            </span>
          </Tooltip>
        </Row>
        {dirty && !blockedByParent && <Muted>いまの内容を版として残し、その版を公開します。</Muted>}
        {publishedDescendants > 0 && !blockedByParent && (
          <FormControlLabel
            control={<Checkbox size="small" checked={applyToDescendants} onChange={(e) => setApplyToDescendants(e.target.checked)} />}
            label={
              <Typography variant="body2">
                配下のすべてのページも同じ公開範囲にする
                {impact.changed > 0 && `（${impact.changed} 件が変わります）`}
              </Typography>
            }
          />
        )}
        {blockedByDescendants && (
          <Typography variant="body2" color="warning.main">
            配下に「{visibilityLabel[visibility]}」より広い公開範囲のページが {impact.wider} 件あるため、このままでは変えられません。「配下のすべてのページも同じ公開範囲にする」を選んでください。
          </Typography>
        )}
        {published && (
          <Row>
            <Button
              variant="outlined"
              disabled={action.isPending}
              onClick={async () => {
                // 配下に公開中のページがあれば、まとめて非公開にする（配下は親より広くできないため）
                const ok = await confirmDialog({
                  title: publishedDescendants > 0 ? "このページと配下のページを非公開にしますか？" : "このページを非公開にしますか？",
                  body:
                    (publishedDescendants > 0 ? `配下の公開中のページ ${publishedDescendants} 件も、まとめて非公開になります。` : "") +
                    "公開サイトから見られなくなります（反映は数分後、ビルドのあとです）。あとでもう一度公開できます。",
                  confirmLabel: publishedDescendants > 0 ? `${publishedDescendants + 1} 件を非公開にする` : "非公開にする",
                  cancelLabel: "公開したままにする",
                });
                if (ok) action.mutate(() => api.unpublish(page.id, publishedDescendants > 0 ? { applyToDescendants: true } : undefined));
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
          <Button
            variant="outlined"
            disabled={action.isPending || !runAt}
            onClick={() =>
              action.mutate(async () =>
                api.createSchedule(
                  scheduleKind === "publish_page"
                    ? {
                        actionType: "publish_page",
                        pageId: page.id,
                        versionId: (await ensureVersion()).headVersionId,
                        targetVisibility: visibility,
                        runAt: jstLocalToIso(runAt),
                      }
                    : { actionType: "unpublish_page", pageId: page.id, runAt: jstLocalToIso(runAt) },
                ),
              )
            }
          >
            予約する
          </Button>
          <Muted>
            {scheduleKind === "publish_page" &&
              `${dirty ? "いまの内容を版として残し、その版を予約します。" : "予約時点の版が公開されます。"}予約後の編集は含まれません。`}
            反映は予約時刻から数分以内です。
          </Muted>
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
    </Box>
  );
}
