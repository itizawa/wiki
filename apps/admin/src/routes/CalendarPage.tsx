import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isoToJstLocal, jstDate, jstLocalToIso, type ScheduledAction } from "@wiki/shared";
import { useMemo, useState, type MouseEvent } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { actionLabel } from "../components/PublishPanel";
import { LoadingRegion, Mono, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { focusAfterRemoval } from "../lib/focus";
import { useScheduleToasts } from "../lib/scheduleActions";
import { pageLink } from "../lib/wiki";
import { formatDateTime, formatDay } from "../lib/format";

const DAY = 24 * 3600_000;
/** 予約ストックがこれを下回ったら警告する（今後 STOCK_DAYS 日の公開予約数） */
const STOCK_DAYS = 7;
const STOCK_MIN = 3;
/**
 * 行の中の、ページの名前の枠。残りの幅を取る。
 * 最低の幅を決めておき、足りなければ右のボタンを次の行へ送る（決めておかないと、スマホの幅ではボタンに押されて1文字ずつ折り返す）。
 */
const titleCellSx = { flex: "1 1 10em", minWidth: 0, overflowWrap: "anywhere" } as const;

/** 行の遷移先。ページが無い予約（ブランチの操作）には無い。 */
export const entryLink = (e: Entry) => (e.kind === "action" ? (e.action.pageId ? pageLink(e.action.pageId) : undefined) : pageLink(e.pageId));
const entryKey = (e: Entry) => (e.kind === "action" ? `action-${e.action.id}` : `${e.kind}-${e.pageId}-${e.at}`);

export type Entry =
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
  const toasts = useScheduleToasts();
  /**
   * 予約を取り消す。確認は挟まず、取り消したことを知らせて「元に戻す」を出す。
   * 押したボタンは行ごと消えるので、次の行（無ければ前の行、全部消えたら見出し）にフォーカスを移す。
   */
  const cancel = (e: MouseEvent<HTMLElement>, action: ScheduledAction) => {
    const row = e.currentTarget.closest("[role=row], li");
    const restore = focusAfterRemoval(row, {
      scope: e.currentTarget.closest("[data-focus-scope]"),
      focusSelector: "[role=row] a[href], li a[href]",
      fallback: () => document.getElementById("calendar-heading"),
    });
    mutate.mutate(() => toasts.cancel(action), { onSuccess: restore });
  };

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
  const thisYear = Number(today.slice(0, 4));
  const [rescheduling, setRescheduling] = useState<ScheduledAction | null>(null);

  // カレンダーに並べるのは予約とページの両方。どちらかを読み込んでいる間は、日付ごとの行の形を出す
  const loading = schedule.isPending || pages.isPending;
  // 予約を読み込む前は件数が分からないので、少ないとは言わない
  const lowStock = !schedule.isPending && stock < STOCK_MIN;
  if (schedule.error) return <Alert severity="error">{errorMessage(schedule.error)}</Alert>;

  const entryColumns: DataListColumn<Entry>[] = [
    {
      key: "time",
      width: "56px",
      sx: { px: 1, color: "text.secondary" },
      render: (e) => <Mono sx={{ color: "text.secondary" }}>{isoToJstLocal(e.at).slice(11)}</Mono>,
    },
    {
      key: "status",
      width: "136px",
      render: (e) =>
        e.kind === "action" ? (
          <StatusChip status={e.action.status} label={actionLabel(e.action)} />
        ) : e.kind === "published" ? (
          <StatusChip status={e.unlisted ? "unlisted" : "public"} label={e.unlisted ? "限定公開済み" : "公開済み"} />
        ) : (
          <StatusChip label="AI下書き" />
        ),
    },
    {
      key: "page",
      // ページの名前は長ければ折り返す。狭い画面でも1文字ずつに潰れない幅を取る
      width: "minmax(160px, 1fr)",
      sx: { overflowWrap: "anywhere" },
      render: (e) =>
        e.kind === "action" ? (
          <Box>
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
        ) : (
          <RouterLink {...pageLink(e.pageId)}>{e.title}</RouterLink>
        ),
    },
    {
      key: "actions",
      // 予約中の行だけにある操作。日をまたいで列がそろうよう、幅を決める
      width: "250px",
      align: "right",
      sx: { px: 1 },
      render: (e) =>
        e.kind === "action" && e.action.status === "scheduled" ? (
          <Row sx={{ flexWrap: "nowrap", justifyContent: "flex-end" }} spacing={0}>
            <Button variant="text" onClick={() => setRescheduling(e.action)} sx={{ whiteSpace: "nowrap" }}>
              日時を変更…
            </Button>
            <Button variant="text" color="error" onClick={(ev) => cancel(ev, e.action)} sx={{ whiteSpace: "nowrap" }}>
              予約を取り消す
            </Button>
          </Row>
        ) : null,
    },
  ];

  return (
    <Stack spacing={1.5} data-focus-scope>
      <Section sx={lowStock ? { borderColor: "warning.main" } : undefined}>
        <Typography variant="h6" component="h2" gutterBottom>
          予約ストック
        </Typography>
        <Typography>
          今後{STOCK_DAYS}日の公開予約：
          {schedule.isPending ? (
            <LoadingRegion component="span" sx={{ display: "inline-block", verticalAlign: "bottom" }}>
              <Skeleton variant="text" width={32} />
            </LoadingRegion>
          ) : (
            <strong>{stock}件</strong>
          )}
        </Typography>
        {lowStock && (
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
                <Box sx={titleCellSx}>
                  <PageLink action={a} /> {actionLabel(a)}（{formatDateTime(a.runAt)}）
                  <Typography component="span" variant="body2" color="error">
                    {" "}
                    {a.lastError}
                  </Typography>
                </Box>
                <Button variant="text" color="error" onClick={(e) => cancel(e, a)}>
                  予約を取り消す
                </Button>
              </Row>
            ))}
          </Stack>
        </Section>
      )}

      <Section>
        {/* 予約を取り消して一覧が空になったとき、フォーカスの移し先になる */}
        <Typography id="calendar-heading" tabIndex={-1} variant="h6" component="h2" sx={{ outline: "none" }}>
          編集カレンダー
        </Typography>
        <Muted gutterBottom>過去14日〜60日先。時刻はJST。</Muted>
        {mutate.error && <Alert severity="error">{errorMessage(mutate.error)}</Alert>}
        {!loading && days.length === 0 && <Muted>予定はありません。</Muted>}
        {loading && (
          // 日付ごとの行（日付の見出し + 予定の行）の形
          <LoadingRegion>
            <Stack spacing={0.5}>
              {[1, 2, 1].map((entries, i) => (
                <Box key={i} sx={{ borderTop: 1, borderColor: "divider", py: 1 }}>
                  <Skeleton variant="text" width={88} sx={{ fontSize: "0.875rem", mb: 0.5 }} />
                  {Array.from({ length: entries }, (_, j) => (
                    <Skeleton key={j} variant="text" width={j === 0 ? "55%" : "40%"} sx={{ fontSize: "0.875rem", my: 0.5 }} />
                  ))}
                </Box>
              ))}
            </Stack>
          </LoadingRegion>
        )}
        <Stack spacing={0.5}>
          {(loading ? [] : days).map(([day, entries]) => (
            <Box key={day} sx={{ borderTop: 1, borderColor: "divider", py: 1, opacity: day < today ? 0.7 : 1 }}>
              <Row sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2" component="h4" color={day === today ? "primary" : undefined}>
                  <time dateTime={day}>{formatDay(day, thisYear)}</time>
                </Typography>
                {day === today && <StatusChip label="今日" />}
              </Row>
              <DataList
                label={`${formatDay(day, thisYear)}の予定`}
                columns={entryColumns}
                rows={entries}
                rowKey={entryKey}
                rowLink={entryLink}
                empty=""
              />
            </Box>
          ))}
        </Stack>
      </Section>
      <RescheduleDialog
        action={rescheduling}
        now={now}
        onClose={() => setRescheduling(null)}
        onSubmit={(action, runAt) => {
          setRescheduling(null);
          mutate.mutate(() => api.reschedule(action.id, runAt));
        }}
      />
    </Stack>
  );
}

/** 予約の日時を変えるダイアログ。日時はピッカーで選ばせ、過去の日時は変更できないことを先に見せる。 */
function RescheduleDialog(props: { action: ScheduledAction | null; now: number; onClose: () => void; onSubmit: (action: ScheduledAction, runAt: string) => void }) {
  // 閉じるアニメーションの間も中身を出したままにする
  const [shown, setShown] = useState<ScheduledAction | null>(null);
  const [value, setValue] = useState("");
  if (props.action && props.action !== shown) {
    setShown(props.action);
    setValue(isoToJstLocal(props.action.runAt));
  }
  const min = isoToJstLocal(new Date(props.now).toISOString());
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
  const past = valid && value < min;
  const unchanged = shown !== null && value === isoToJstLocal(shown.runAt);
  return (
    <Dialog open={props.action !== null} onClose={props.onClose} fullWidth maxWidth="xs" aria-labelledby="reschedule-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (shown && valid && !past && !unchanged) props.onSubmit(shown, jstLocalToIso(value));
        }}
      >
        <DialogTitle id="reschedule-title">予約の日時を変更</DialogTitle>
        <DialogContent>
          <Muted sx={{ mb: 2 }}>
            「{shown?.pageTitle ?? shown?.pageId}」の{shown && actionLabel(shown)}の予約（いまは {shown && formatDateTime(shown.runAt)}）
          </Muted>
          <TextField
            autoFocus
            fullWidth
            type="datetime-local"
            label="新しい日時（JST）"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={past}
            helperText={past ? "過去の日時です。いまより先の日時を選んでください。" : "いまより先の日時を選べます。"}
            slotProps={{ htmlInput: { min }, inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={props.onClose}>変更しない</Button>
          <Button type="submit" variant="contained" disabled={!valid || past || unchanged}>
            日時を変更する
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function PageLink({ action }: { action: ScheduledAction }) {
  if (!action.pageId) return <span>{action.branchName}</span>;
  return (
    <RouterLink {...pageLink(action.pageId)}>
      {action.pageTitle ?? action.pageId}
    </RouterLink>
  );
}
