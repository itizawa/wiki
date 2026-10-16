import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  isWorkflowRunActive,
  WORKFLOW_RUN_STATUS_LABELS,
  type WorkflowRunActionEntry,
  type WorkflowRunEntry,
  type WorkflowRunPage,
  type WorkflowRunStatus,
} from "@wiki/shared";
import { CircleAlert, CircleCheck, CircleMinus, Clock, ExternalLink, LoaderCircle } from "lucide-react";
import { useState, type ReactElement } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { Muted, RouterLink, Section } from "../components/ui";
import { api } from "../lib/api";
import { formatShortDateTime } from "../lib/format";
import { pageLink } from "../lib/wiki";
import { BLOCKS_SECTION_ID } from "./WorkflowBlocksSection";

/** 実行のきっかけの表示：タグがトリガーなら、そのタグ名。初めての公開なら「初めての公開」 */
export function runTriggerText(r: Pick<WorkflowRunEntry, "triggerType" | "tagName">): string {
  return r.triggerType === "page_first_published" ? "初めての公開" : r.triggerType === "schedule" ? "時刻" : (r.tagName ?? "");
}

const PAGE_SIZE = 50;
const ROW_HEIGHT = 72;
/** 実行待ち・実行中の行があるあいだ、履歴を取り直す間隔 */
export const RUNS_REFETCH_MS = 30_000;

const STATUS_VIEW: Record<WorkflowRunStatus, { color: "default" | "success" | "error" | "warning" | "info"; icon: ReactElement }> = {
  pending: { color: "info", icon: <Clock size={14} /> },
  running: { color: "info", icon: <LoaderCircle size={14} /> },
  succeeded: { color: "success", icon: <CircleCheck size={14} /> },
  failed: { color: "error", icon: <CircleAlert size={14} /> },
  skipped: { color: "default", icon: <CircleMinus size={14} /> },
};

/** 取り直すか：読み込んだ分に、実行待ち・実行中の行があるあいだだけ */
export function refetchIntervalFor(pages: WorkflowRunPage[] | undefined): number | false {
  return pages?.some((p) => p.runs.some((r) => isWorkflowRunActive(r.status))) ? RUNS_REFETCH_MS : false;
}

/** 一覧の「結果」の列に出す一文。失敗と見送りは理由をそのまま出す */
export function runResultText(run: WorkflowRunEntry): string {
  switch (run.status) {
    case "pending":
      return run.attempts > 0 ? `${run.attempts} 回試して失敗。もう一度試すのを待っています${run.error ? `（${run.error}）` : ""}` : "実行を待っています";
    case "running":
      return "実行しています";
    case "succeeded":
      return `${run.actions.length} 件のアクションを実行しました`;
    case "failed":
      return run.error ?? "失敗しました（理由は記録されていません）";
    case "skipped":
      return `実行を見送りました${run.error ? `：${run.error}` : ""}`;
  }
}

function StatusBadge({ status }: { status: WorkflowRunStatus }) {
  const view = STATUS_VIEW[status];
  // 色だけに頼らず、文字とアイコンで状態を伝える
  return <Chip size="small" color={view.color} variant={status === "failed" ? "filled" : "outlined"} icon={view.icon} label={WORKFLOW_RUN_STATUS_LABELS[status]} />;
}

type PageOption = { id: string; title: string };

/** 履歴を絞るページを選ぶ欄。打った語で検索し、語が無いときは最近更新したページを出す。選びを外すと、全部の実行に戻る */
function RunsPageFilter({ value, onChange }: { value: PageOption | null; onChange: (page: PageOption | null) => void }) {
  const [input, setInput] = useState("");
  const results = useQuery({ queryKey: ["workflow-runs-filter-pages", input], queryFn: () => api.search(input.trim()), placeholderData: (prev) => prev });
  const options = (results.data?.results ?? []).map((r) => ({ id: r.id, title: r.title }));
  return (
    <Autocomplete
      size="small"
      sx={{ maxWidth: 360, mb: 1.5 }}
      options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
      value={value}
      getOptionLabel={(o) => o.title || "（無題）"}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(xs) => xs}
      onChange={(_, p) => onChange(p)}
      onInputChange={(_, v, reason) => reason === "input" && setInput(v)}
      loading={results.isFetching}
      loadingText="検索しています…"
      noOptionsText="見つかるページがありません"
      clearText="絞り込みを外す"
      renderInput={(params) => <TextField {...params} placeholder="ページで絞り込む（タイトルで探す）" slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": "実行の履歴をページで絞り込む" } }} />}
    />
  );
}

/** 「実行の履歴」の節：ワークフローの実行を新しい順に出す。失敗の理由と、Routine のセッションへたどれる。 */
export function WorkflowRunsSection({ workflowId }: { workflowId: string }) {
  const [opened, setOpened] = useState<string | null>(null);
  const [pageFilter, setPageFilter] = useState<PageOption | null>(null);
  const runs = useInfiniteQuery({
    queryKey: ["workflow-runs", workflowId, pageFilter?.id ?? null],
    queryFn: ({ pageParam }) => api.listWorkflowRuns(workflowId, { pageId: pageFilter?.id, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (q) => refetchIntervalFor(q.state.data?.pages),
  });
  const rows = runs.data?.pages.flatMap((p) => p.runs);
  const openedRun = rows?.find((r) => r.id === opened) ?? null;

  const columns: DataListColumn<WorkflowRunEntry>[] = [
    { key: "at", header: "日時", width: "110px", sx: { whiteSpace: "nowrap" }, render: (r) => formatShortDateTime(r.createdAt) },
    { key: "status", header: "状態", width: "120px", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "page",
      header: "ページ",
      width: "minmax(140px, 1fr)",
      sx: { overflowWrap: "anywhere" },
      render: (r) =>
        r.page.available ? (
          <RouterLink {...pageLink(r.page.id)} sx={{ fontWeight: 600 }}>
            {r.page.title || "無題"}
          </RouterLink>
        ) : (
          <Muted component="span">{r.page.title}</Muted>
        ),
    },
    {
      key: "result",
      header: "結果",
      width: "minmax(220px, 1.4fr)",
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", color: r.status === "failed" ? "error.main" : "text.primary" }}
          >
            {runResultText(r)}
          </Typography>
          <Button size="small" onClick={() => setOpened(r.id)} aria-label={`${r.page.title}の実行の詳細を見る`} sx={{ px: 0, minWidth: 0 }}>
            詳細を見る
          </Button>
        </Box>
      ),
    },
    { key: "tag", header: "トリガー", width: "minmax(100px, 160px)", sx: { overflowWrap: "anywhere" }, render: runTriggerText },
  ];

  return (
    <Section>
      <HelpHeading
        variant="subtitle1"
        component="h2"
        sx={{ mb: 1 }}
        help="ブロックのトリガー（タグが付いたとき・初めて公開されたとき・決まった時刻）で積まれた実行の記録です。新しい順に並び、終わってから90日たった記録は、毎日の掃除で消えます。実行待ちや実行中の行があるあいだは、30秒ごとに最新の状態に取り直します。失敗した実行は、「詳細を見る」から、理由と Routine のセッションを開けます。"
      >
        実行の履歴
      </HelpHeading>
      <RunsPageFilter value={pageFilter} onChange={setPageFilter} />
      <DataList
        label="実行の履歴"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLink={(r) => (r.page.available ? pageLink(r.page.id) : undefined)}
        error={runs.error}
        empty={
          pageFilter ? (
            <>「{pageFilter.title || "無題"}」の実行はありません。絞り込みを外すと、ほかのページの実行も見られます。</>
          ) : (
          <>
            まだ実行はありません。ブロックのトリガー（タグが付く・初めて公開される・決まった時刻になる）が起きると、ここに実行が出ます。{" "}
            <Link component="button" type="button" onClick={() => document.getElementById(BLOCKS_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })} sx={{ verticalAlign: "baseline" }}>
              ブロックの節へ
            </Link>
          </>
          )
        }
        rowHeight={ROW_HEIGHT}
        skeletonRows={3}
        virtualized
        hasNextPage={runs.hasNextPage}
        isFetchingNextPage={runs.isFetchingNextPage}
        fetchNextPage={runs.fetchNextPage}
        nextPageError={runs.isFetchNextPageError ? runs.error : undefined}
      />
      {openedRun && <RunDialog run={openedRun} onClose={() => setOpened(null)} />}
    </Section>
  );
}

const ACTION_STATUS_LABELS: Record<WorkflowRunActionEntry["status"], string> = { pending: "未実行", succeeded: "成功", failed: "失敗" };

/** 実行の詳細：アクションごとの結果。Routine のセッションは外部リンク、失敗の理由はそのまま読める。 */
function RunDialog({ run, onClose }: { run: WorkflowRunEntry; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="workflow-run-title">
      <DialogTitle id="workflow-run-title">実行の詳細</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
          <StatusBadge status={run.status} />
          <Typography variant="body2" color="text.secondary">
            {formatShortDateTime(run.createdAt)}
            {run.attempts > 0 && `・${run.attempts} 回試した`}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          ページ：
          {run.page.available ? <RouterLink {...pageLink(run.page.id)}>{run.page.title || "無題"}</RouterLink> : run.page.title}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
          {run.triggerType === "tag_attached" ? "タグ：" : "トリガー："}
          {runTriggerText(run)}
        </Typography>
        {run.error && run.status !== "succeeded" && !run.actions.some((a) => a.error === run.error) && (
          <Alert severity={run.status === "failed" ? "error" : "info"} sx={{ mt: 1.5, overflowWrap: "anywhere" }}>
            {run.error}
          </Alert>
        )}
        <Typography variant="subtitle2" component="h3" sx={{ mt: 2, mb: 1 }}>
          アクションごとの結果
        </Typography>
        {run.actions.length === 0 ? (
          <Muted>アクションの記録がありません。</Muted>
        ) : (
          <Box component="ol" aria-label="アクションごとの結果" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
            {run.actions.map((a, i) => (
              <Box component="li" key={i} sx={{ display: "grid", gap: 0.5, overflowWrap: "anywhere" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {i + 1}. {a.label}
                  <Box component="span" sx={{ ml: 1, fontWeight: 400, color: a.status === "failed" ? "error.main" : "text.secondary" }}>
                    {ACTION_STATUS_LABELS[a.status]}
                  </Box>
                </Typography>
                {a.error && (
                  <Typography variant="body2" color={a.status === "failed" ? "error" : "text.secondary"}>
                    {a.status === "failed" ? "失敗の理由" : "直近の失敗の理由"}：{a.error}
                  </Typography>
                )}
                {a.sessionUrl && (
                  <Link href={a.sessionUrl} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    Routine のセッションを開く（新しいタブ）
                    <ExternalLink size={14} aria-hidden />
                  </Link>
                )}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}
