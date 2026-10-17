import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { TASK_ASSIGNEE_NONE, TASK_STATUS_LABELS, TASK_STATUSES, type Task } from "@wiki/shared";
import { useMemo, useState } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { ListToolbar, appliedFiltersText, filterValues, type ActiveFilter, type FilterField, type FilterOption, type SortField, type SortValue } from "../components/ListToolbar";
import { Muted, RouterLink, Section } from "../components/ui";
import { api } from "../lib/api";
import { useScreenTitle } from "../lib/documentTitle";
import { formatShortDateTime } from "../lib/format";
import { taskKeys, taskLink } from "../lib/tasks";
import { pageLink } from "../lib/wiki";
import { useSession } from "./Layout";
import { assigneeChoices, assigneeText, TaskStatusBadge } from "./taskView";

const PAGE_SIZE = 50;
const ROW_HEIGHT = 56;

const SORT_FIELDS: SortField[] = [{ key: "createdAt", label: "作った日時", asc: "古い順", desc: "新しい順" }];

const STATUS_OPTIONS: FilterOption[] = TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }));

/** はじめは、終わっていないもの（未着手・進行中）に絞って出す。チップから外せる */
export const INITIAL_TASK_FILTERS: ActiveFilter[] = [{ key: "status", values: STATUS_OPTIONS.filter((o) => o.value !== "done") }];

/**
 * この wiki のタスクの一覧（`/w/{key}/tasks`）。ワークフローの「人の作業」が作ったタスクが並び、行を押すと詳細へ移る（詳細で状態と担当者を変える）。
 * はじめは未着手・進行中だけを、作った日時の新しい順に出す。状態と担当者で絞れる。wiki のメンバーなら誰でも見られる
 */
export function TasksPage() {
  useScreenTitle("タスク");
  const me = useSession();
  const [filters, setFilters] = useState<ActiveFilter[]>(INITIAL_TASK_FILTERS);
  const [sort, setSort] = useState<SortValue>({ key: "createdAt", direction: "desc" });
  const members = useQuery({ queryKey: ["members"], queryFn: api.listMembers });

  const filterFields = useMemo<FilterField[]>(() => {
    const people = assigneeChoices(members.data?.members ?? [], me).filter((c) => c.id !== me.id);
    return [
      { key: "status", label: "状態", kind: "select", options: STATUS_OPTIONS },
      {
        key: "assignee",
        label: "担当者",
        kind: "select",
        options: [{ value: me.id, label: "自分" }, { value: TASK_ASSIGNEE_NONE, label: "担当者なし" }, ...people.map((p) => ({ value: p.id, label: p.name }))],
      },
    ];
  }, [members.data, me]);

  const status = filterValues(filters, "status")?.flatMap((v) => TASK_STATUSES.filter((s) => s === v));
  const assignee = filterValues(filters, "assignee");
  const order = sort.direction;
  const list = useInfiniteQuery({
    queryKey: taskKeys.list({ status, assignee, order }),
    queryFn: ({ pageParam }) => api.listTasks({ status, assignee, order, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = useMemo(() => {
    if (!list.data) return undefined;
    // 読み直しと続きの読み込みが重なっても、同じ行を2度出さない
    const seen = new Set<string>();
    return list.data.pages.flatMap((p) => p.tasks).filter((t) => !seen.has(t.id) && seen.add(t.id));
  }, [list.data]);

  const columns: DataListColumn<Task>[] = [
    {
      key: "title",
      header: "タスク",
      width: "minmax(200px, 1.4fr)",
      stickyLeft: 0,
      sx: { overflowWrap: "anywhere" },
      render: (t) => (
        <Box sx={{ minWidth: 0 }}>
          <RouterLink {...taskLink(t.id)} sx={{ fontWeight: 600 }}>
            {t.title}
          </RouterLink>
          {t.workflow && <Muted sx={{ fontSize: "0.75rem" }}>ワークフロー「{t.workflow.name}」</Muted>}
        </Box>
      ),
    },
    { key: "status", header: "状態", width: "104px", render: (t) => <TaskStatusBadge status={t.status} /> },
    {
      key: "page",
      header: "ページ",
      width: "minmax(140px, 1fr)",
      narrow: "stack",
      sx: { overflowWrap: "anywhere" },
      render: (t) =>
        !t.page ? (
          <Muted component="span">なし</Muted>
        ) : t.page.available ? (
          <RouterLink {...pageLink(t.page.id)}>{t.page.title || "無題"}</RouterLink>
        ) : (
          <Muted component="span">{t.page.title}</Muted>
        ),
    },
    {
      key: "assignee",
      header: "担当者",
      width: "minmax(100px, 160px)",
      narrow: "stack",
      sx: { overflowWrap: "anywhere" },
      render: (t) => (t.assignee ? (t.assignee.id === me.id ? `${t.assignee.name}（自分）` : t.assignee.name) : <Muted component="span">{assigneeText(t)}</Muted>),
    },
    {
      key: "createdAt",
      header: "作った日時",
      width: "110px",
      narrow: "hide",
      sort: order === "asc" ? "ascending" : "descending",
      sx: { whiteSpace: "nowrap" },
      render: (t) => <Muted component="span">{formatShortDateTime(t.createdAt)}</Muted>,
    },
  ];

  const filtered = status !== undefined || assignee !== undefined;

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          sx={{ mb: 1 }}
          help="ワークフローの「人の作業（タスクを作る）」のアクションまで進むと、ここにタスクができ、そのワークフローの実行は止まって待ちます。タスクを開いて「完了」にすると、止まっていた実行が次のアクションから続きます。担当者が決まっていないタスクは、この wiki のメンバーなら誰でも自分に割り当てて進められます。"
        >
          タスク
        </HelpHeading>
        <ListToolbar
          label="タスクの絞り込みと並べ替え"
          sortFields={SORT_FIELDS}
          sort={sort}
          onSortChange={setSort}
          filterFields={filterFields}
          filters={filters}
          onFiltersChange={setFilters}
        />
        <DataList
          label="タスクの一覧"
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          rowLink={(t) => taskLink(t.id)}
          error={list.error}
          empty={
            filtered ? (
              <>
                条件（{appliedFiltersText(filterFields, filters)}）に合うタスクはありません。{" "}
                <Link component="button" type="button" onClick={() => setFilters([])} sx={{ verticalAlign: "baseline" }}>
                  絞り込みをすべて外す
                </Link>
              </>
            ) : (
              <>タスクはまだありません。ワークフローのブロックに「人の作業（タスクを作る）」のアクションを置くと、そこまで進んだときに、ここにタスクができます。</>
            )
          }
          rowHeight={ROW_HEIGHT}
          skeletonRows={3}
          virtualized
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          fetchNextPage={list.fetchNextPage}
          nextPageError={list.isFetchNextPageError ? list.error : undefined}
        />
      </Section>
    </Stack>
  );
}
