import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  isWorkflowRunActive,
  WORKFLOW_RUN_STATUS_LABELS,
  WORKFLOW_RUN_STATUSES,
  type WorkflowRunActionEntry,
  type WorkflowRunEntry,
  type WorkflowRunPage,
  type WorkflowRunStatus,
} from "@wiki/shared";
import { CircleAlert, CircleCheck, CircleMinus, Clock, ExternalLink, LoaderCircle, UserRoundCheck } from "lucide-react";
import { useId, useState, type ReactElement } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { ListToolbar, appliedFiltersText, filterValues, type ActiveFilter, type FilterField, type SortField, type SortValue } from "../components/ListToolbar";
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
  waiting: { color: "warning", icon: <UserRoundCheck size={14} /> },
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
    case "waiting":
      return "タスクの完了を待っています（完了にすると続きから動きます）";
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

const SORT_FIELDS: SortField[] = [{ key: "createdAt", label: "日時", asc: "古い順", desc: "新しい順" }];

const FILTER_FIELDS: FilterField[] = [
  {
    key: "page",
    label: "ページ",
    kind: "search",
    // 語が無いときは、最近更新したページが出る
    search: async (q) => (await api.search(q)).results.map((r) => ({ value: r.id, label: r.title || "無題" })),
    placeholder: "タイトルで探す",
  },
  { key: "status", label: "状態", kind: "select", options: WORKFLOW_RUN_STATUSES.map((s) => ({ value: s, label: WORKFLOW_RUN_STATUS_LABELS[s] })) },
];

/** 「実行の履歴」の節：ワークフローの実行を日時の順に出す（はじめは新しい順。ページと状態で絞れる）。失敗の理由と、Routine のセッションへたどれる。 */
export function WorkflowRunsSection({ workflowId }: { workflowId: string }) {
  const [opened, setOpened] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [sort, setSort] = useState<SortValue>({ key: "createdAt", direction: "desc" });
  const pageId = filterValues(filters, "page");
  const status = filterValues(filters, "status")?.flatMap((v) => WORKFLOW_RUN_STATUSES.filter((s) => s === v));
  const order = sort.direction;
  const runs = useInfiniteQuery({
    queryKey: ["workflow-runs", workflowId, { pageId, status, order }],
    queryFn: ({ pageParam }) => api.listWorkflowRuns(workflowId, { pageId, status, order, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (q) => refetchIntervalFor(q.state.data?.pages),
  });
  const rows = runs.data?.pages.flatMap((p) => p.runs);
  const openedRun = rows?.find((r) => r.id === opened) ?? null;

  const columns: DataListColumn<WorkflowRunEntry>[] = [
    { key: "at", header: "日時", width: "110px", sort: order === "asc" ? "ascending" : "descending", sx: { whiteSpace: "nowrap" }, render: (r) => formatShortDateTime(r.createdAt) },
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
        help="ブロックのトリガー（タグが付いたとき・初めて公開されたとき・決まった時刻）で積まれた実行の記録です。はじめは新しい順に並び（上の「日時」のチップで古い順にできます）、「＋ フィルター」でページや状態で絞れます。終わってから90日たった記録は、毎日の掃除で消えます。実行待ちや実行中の行があるあいだは、30秒ごとに最新の状態に取り直します。「詳細を見る」から、Routine に頼んだ内容を読めます。失敗した実行は、理由と Routine のセッションも開けます。"
      >
        実行の履歴
      </HelpHeading>
      <ListToolbar
        label="実行の履歴の絞り込みと並べ替え"
        sortFields={SORT_FIELDS}
        sort={sort}
        onSortChange={setSort}
        filterFields={FILTER_FIELDS}
        filters={filters}
        onFiltersChange={setFilters}
      />
      <DataList
        label="実行の履歴"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowLink={(r) => (r.page.available ? pageLink(r.page.id) : undefined)}
        error={runs.error}
        empty={
          pageId || status ? (
            <>
              条件（{appliedFiltersText(FILTER_FIELDS, filters)}）に合う実行はありません。{" "}
              <Link component="button" type="button" onClick={() => setFilters([])} sx={{ verticalAlign: "baseline" }}>
                絞り込みをすべて外す
              </Link>
            </>
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

/** 頼んだ内容を、はじめに見せる行数。これより長い文は折りたたむ */
export const INSTRUCTION_PREVIEW_LINES = 4;
/** 詳細の欄の幅で、1行におおよそ入る文字数（折り返しで行が増える分の目安） */
const INSTRUCTION_CHARS_PER_LINE = 36;

/** 頼んだ内容が、はじめに見せる行数に収まらないか（収まらなければ、折りたたんで「すべて表示」を出す） */
export function isLongInstruction(text: string): boolean {
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / INSTRUCTION_CHARS_PER_LINE)), 0);
  return lines > INSTRUCTION_PREVIEW_LINES;
}

/** Routine に頼んだ内容。改行はそのまま出し、長い文ははじめの数行だけにして、押すと全文を出す */
function RoutineInstruction({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = isLongInstruction(text);
  const clamped = long && !expanded;
  return (
    <Box>
      <Typography variant="caption" component="p" color="text.secondary">
        頼んだ内容
      </Typography>
      <Typography
        id={id}
        variant="body2"
        sx={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          bgcolor: "action.hover",
          borderLeft: 3,
          borderColor: "divider",
          borderRadius: 1,
          px: 1.5,
          py: 1,
          ...(clamped && { display: "-webkit-box", WebkitLineClamp: INSTRUCTION_PREVIEW_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }),
        }}
      >
        {text}
      </Typography>
      {long && (
        <Button size="small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={id} sx={{ px: 0, minWidth: 0 }}>
          {expanded ? "頼んだ内容を折りたたむ" : "頼んだ内容をすべて表示する"}
        </Button>
      )}
    </Box>
  );
}

/** 実行の詳細：アクションごとの結果。Routine に頼んだ内容と失敗の理由はそのまま読め、Routine のセッションは外部リンクで開ける。 */
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
                {a.instruction && <RoutineInstruction text={a.instruction} />}
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
