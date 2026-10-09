import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isoToJstLocal, jstDate, jstLocalToIso, type ScheduledAction } from "@wiki/shared";
import { useMemo, useState } from "react";
import { actionLabel } from "../components/PublishPanel";
import { Mono, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";

const DAY = 24 * 3600_000;
/** 予約ストックがこれを下回ったら警告する（今後 STOCK_DAYS 日の公開予約数） */
const STOCK_DAYS = 7;
const STOCK_MIN = 3;

type Entry =
  | { kind: "action"; at: string; action: ScheduledAction }
  | { kind: "published"; at: string; pageId: string; title: string; unlisted: boolean }
  | { kind: "draft"; at: string; pageId: string; title: string };

/** 編集カレンダー：公開済み・予約済み・AI下書きを日付で並べる。 */
export function CalendarPage() {
  const qc = useQueryClient();
  const [now] = useState(() => Date.now());
  const from = new Date(now - 14 * DAY).toISOString();
  const to = new Date(now + 60 * DAY).toISOString();
  const schedule = useQuery({ queryKey: ["schedule", "calendar", from], queryFn: () => api.listSchedule({ from, to }) });
  const failed = useQuery({ queryKey: ["schedule", "failed"], queryFn: () => api.listSchedule({ status: "failed" }) });
  const pages = useQuery({ queryKey: ["pages", ""], queryFn: () => api.listPages() });
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  const days = useMemo(() => {
    const entries: Entry[] = [];
    for (const a of schedule.data?.actions ?? []) {
      if (a.status !== "canceled") entries.push({ kind: "action", at: a.runAt, action: a });
    }
    for (const p of pages.data?.pages ?? []) {
      const inRange = (iso: string) => iso >= from && iso < to;
      if (p.firstPublishedAt && inRange(p.firstPublishedAt) && p.publishedVersionId) {
        // 予約で公開されたものは予約側に出ているので重ねない
        const fromSchedule = (schedule.data?.actions ?? []).some(
          (a) => a.pageId === p.id && a.status === "done" && a.actionType === "publish_page" && a.runAt === p.firstPublishedAt,
        );
        if (!fromSchedule) entries.push({ kind: "published", at: p.firstPublishedAt, pageId: p.id, title: p.title, unlisted: p.visibility === "unlisted" });
      }
      if (p.origin === "ai_draft" && !p.publishedVersionId) {
        entries.push({ kind: "draft", at: p.updatedAt, pageId: p.id, title: p.title });
      }
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));
    const map = new Map<string, Entry[]>();
    for (const e of entries) map.set(jstDate(e.at), [...(map.get(jstDate(e.at)) ?? []), e]);
    return [...map];
  }, [schedule.data, pages.data, from, to]);

  const stock = (schedule.data?.actions ?? []).filter(
    (a) =>
      a.status === "scheduled" &&
      a.actionType === "publish_page" &&
      new Date(a.runAt).getTime() < now + STOCK_DAYS * DAY,
  ).length;
  const today = jstDate(new Date(now).toISOString());

  if (schedule.isPending || pages.isPending) return <Muted>読み込み中…</Muted>;
  if (schedule.error) return <Alert severity="error">{errorMessage(schedule.error)}</Alert>;

  return (
    <Stack spacing={1.5}>
      <Section sx={stock < STOCK_MIN ? { borderColor: "warning.main" } : undefined}>
        <Typography variant="h6" component="h2" gutterBottom>
          予約ストック
        </Typography>
        <Typography>
          今後{STOCK_DAYS}日の公開予約：<strong>{stock}件</strong>
        </Typography>
        {stock < STOCK_MIN && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            予約が少なくなっています。継続配信が途切れないよう記事を予約してください。
          </Alert>
        )}
      </Section>

      {(failed.data?.actions.length ?? 0) > 0 && (
        <Section>
          <Typography variant="h6" component="h2" color="error" gutterBottom>
            失敗した予約
          </Typography>
          <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {failed.data!.actions.map((a) => (
              <Row component="li" key={a.id}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <PageLink action={a} /> {actionLabel(a)}（{isoToJstLocal(a.runAt).replace("T", " ")}）
                  <Typography component="span" variant="body2" color="error">
                    {" "}
                    {a.lastError}
                  </Typography>
                </Box>
                <Button variant="text" color="error" onClick={() => mutate.mutate(() => api.cancelSchedule(a.id))}>
                  キャンセル
                </Button>
              </Row>
            ))}
          </Stack>
        </Section>
      )}

      <Section>
        <Typography variant="h6" component="h2">
          編集カレンダー
        </Typography>
        <Muted gutterBottom>過去14日〜60日先。時刻はJST。</Muted>
        {mutate.error && <Alert severity="error">{errorMessage(mutate.error)}</Alert>}
        {days.length === 0 && <Muted>予定はありません。</Muted>}
        <Stack spacing={0.5}>
          {days.map(([day, entries]) => (
            <Box key={day} sx={{ borderTop: 1, borderColor: "divider", py: 1, opacity: day < today ? 0.7 : 1 }}>
              <Row sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" component="h4" color={day === today ? "primary" : undefined}>
                  {day}
                </Typography>
                {day === today && <StatusChip label="今日" />}
              </Row>
              <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0, typography: "body2" }}>
                {entries.map((e, i) => (
                  <Row component="li" key={i}>
                    <Mono sx={{ color: "text.secondary" }}>{isoToJstLocal(e.at).slice(11)}</Mono>
                    {e.kind === "action" && (
                      <>
                        <StatusChip status={e.action.status} label={actionLabel(e.action)} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <PageLink action={e.action} />
                          {e.action.editedAfterSchedule && (
                            <Box component="span" sx={{ color: "warning.main" }}>
                              {" "}
                              予約後に編集あり
                            </Box>
                          )}
                          {e.action.status === "done" && (
                            <Box component="span" sx={{ color: "text.secondary" }}>
                              {" "}
                              実行済み
                            </Box>
                          )}
                        </Box>
                        {e.action.status === "scheduled" && (
                          <>
                            <Button
                              variant="text"
                              onClick={() => {
                                const next = prompt("新しい日時（JST, YYYY-MM-DDTHH:mm）", isoToJstLocal(e.action.runAt));
                                if (next) mutate.mutate(() => api.reschedule(e.action.id, jstLocalToIso(next)));
                              }}
                            >
                              変更
                            </Button>
                            <Button variant="text" color="error" onClick={() => mutate.mutate(() => api.cancelSchedule(e.action.id))}>
                              キャンセル
                            </Button>
                          </>
                        )}
                      </>
                    )}
                    {e.kind === "published" && (
                      <>
                        <StatusChip status={e.unlisted ? "unlisted" : "public"} label={e.unlisted ? "限定公開済み" : "公開済み"} />
                        <RouterLink to="/pages/$pageId" params={{ pageId: e.pageId }}>
                          {e.title}
                        </RouterLink>
                      </>
                    )}
                    {e.kind === "draft" && (
                      <>
                        <StatusChip label="AI下書き" />
                        <RouterLink to="/pages/$pageId" params={{ pageId: e.pageId }}>
                          {e.title}
                        </RouterLink>
                      </>
                    )}
                  </Row>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

function PageLink({ action }: { action: ScheduledAction }) {
  if (!action.pageId) return <span>{action.branchName}</span>;
  return (
    <RouterLink to="/pages/$pageId" params={{ pageId: action.pageId }}>
      {action.pageTitle ?? action.pageId}
    </RouterLink>
  );
}
