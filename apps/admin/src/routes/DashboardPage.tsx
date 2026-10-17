import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { GaAnalytics, PageSummary, ScheduledAction, WikiAnalytics } from "@wiki/shared";
import { DEFAULT_ANALYTICS_DAYS } from "@wiki/shared";
import type { ReactNode } from "react";
import { DataList, type DataListColumn } from "../components/DataList";
import { DonutChart } from "../components/DonutChart";
import { HelpHeading } from "../components/HelpTip";
import { actionLabel } from "../components/PublishPanel";
import { LoadingRegion, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { changeLabel, channelLabel, failureText, gaIsEmpty } from "../lib/analytics";
import { api, errorMessage } from "../lib/api";
import { useScreenTitle } from "../lib/documentTitle";
import { donutSlices } from "../lib/donut";
import { formatDateTime } from "../lib/format";
import { pageLink, screenLink } from "../lib/wiki";

/** 各一覧に出す件数。多くは「すべて見る」から。 */
export const DASHBOARD_ROWS = 6;
/** 閲覧数の要約に使う期間（アクセス解析の既定と同じ。同じ数字を取り回す） */
const DAYS = DEFAULT_ANALYTICS_DAYS;
const nowrap = { whiteSpace: "nowrap" } as const;
const numberSx = { fontVariantNumeric: "tabular-nums" } as const;
const count = (n: number) => n.toLocaleString("ja-JP");

/** `/w/{key}`（wiki のトップ）：最近更新したページ・下書き・予約公開の一覧と、閲覧数の要約。詳しい数字は「アクセス解析」で見る。 */
export function DashboardPage() {
  useScreenTitle("ダッシュボード");
  return (
    <Stack spacing={1.5}>
      <Typography variant="h5" component="h1">
        ダッシュボード
      </Typography>
      <ViewsSummary />
      <RecentPages />
      <Drafts />
      <Scheduled />
    </Stack>
  );
}

/** 見出しと、右端の「すべて見る」リンク。 */
function Block({ title, help, link, children }: { title: string; help: ReactNode; link: ReactNode; children: ReactNode }) {
  return (
    <Section>
      <Row sx={{ mb: 1, justifyContent: "space-between" }}>
        <HelpHeading variant="h6" component="h2" help={help}>
          {title}
        </HelpHeading>
        {link}
      </Row>
      {children}
    </Section>
  );
}

/**
 * 「すべてのページを見る」。描画のたびに呼ぶ（`screenLink` は呼んだ時点の wiki を読むので、モジュールの外側で一度だけ作ると、
 * wiki が決まる前の空の key のまま `/w//pages` を指してしまう）。
 */
export function allPagesLink() {
  return (
    <RouterLink {...screenLink("/w/$wikiKey/pages")} underline="always">
      すべてのページを見る
    </RouterLink>
  );
}

const titleColumn: DataListColumn<PageSummary> = {
  key: "title",
  header: "タイトル",
  width: "minmax(160px, 1fr)",
  sx: { overflowWrap: "anywhere" },
  render: (p) => (
    <RouterLink {...pageLink(p.id)}>
      {p.icon && <span aria-hidden>{p.icon} </span>}
      {p.title}
    </RouterLink>
  ),
};
const updatedColumn: DataListColumn<PageSummary> = {
  key: "updatedAt",
  header: "更新日時",
  narrow: "stack",
  width: "160px",
  sx: nowrap,
  render: (p) => <Muted component="span">{formatDateTime(p.updatedAt)}</Muted>,
};
/** 下書きのタイトル。AI が書いたものには印を付ける（行を増やさず、列も足さない）。 */
const draftTitleColumn: DataListColumn<PageSummary> = {
  ...titleColumn,
  render: (p) => (
    <>
      {titleColumn.render(p)}
      {p.origin === "ai_draft" && <StatusChip label="AI下書き" size="small" sx={{ ml: 1 }} />}
    </>
  ),
};

function PageList({ label, rows, error, empty, columns }: { label: string; rows: PageSummary[] | undefined; error: unknown; empty: string; columns: DataListColumn<PageSummary>[] }) {
  return <DataList label={label} columns={columns} rows={rows} rowKey={(p) => p.id} rowLink={(p) => pageLink(p.id)} error={error} empty={empty} skeletonRows={3} />;
}

function RecentPages() {
  const recent = useQuery({ queryKey: ["pages", "dashboard", "recent"], queryFn: () => api.listPagesPage({ limit: DASHBOARD_ROWS }) });
  return (
    <Block title="最近更新したページ" help={`更新日時が新しい順に、${DASHBOARD_ROWS} 件まで出します。`} link={allPagesLink()}>
      <PageList
        label="最近更新したページの一覧"
        rows={recent.data?.pages}
        error={recent.error}
        empty="ページはまだありません。サイドバーの「最上位に新しいページ」（＋）から作れます。"
        columns={[titleColumn, updatedColumn]}
      />
    </Block>
  );
}

function Drafts() {
  const drafts = useQuery({ queryKey: ["pages", "dashboard", "drafts"], queryFn: () => api.listPagesPage({ limit: DASHBOARD_ROWS, unpublished: true }) });
  return (
    <Block
      title="下書き"
      help={`まだ一度も公開していないページです。更新日時が新しい順に、${DASHBOARD_ROWS} 件まで出します。AI が書いたものには「AI下書き」と付きます。`}
      link={allPagesLink()}
    >
      <PageList
        label="下書きの一覧"
        rows={drafts.data?.pages}
        error={drafts.error}
        empty="下書きはありません。まだ公開していないページは、ここに並びます。"
        columns={[draftTitleColumn, updatedColumn]}
      />
    </Block>
  );
}

const runAtColumn: DataListColumn<ScheduledAction> = {
  key: "runAt",
  header: "実行予定",
  narrow: "stack",
  width: "160px",
  sx: nowrap,
  render: (a) => <Muted component="span">{formatDateTime(a.runAt)}</Muted>,
};
/** ページ名と、予約した操作（公開・非公開化など）。操作は、列を分けず名前のあとに付ける（狭い画面で横に送らせない）。 */
const scheduledTitleColumn: DataListColumn<ScheduledAction> = {
  key: "title",
  header: "ページ",
  width: "minmax(160px, 1fr)",
  sx: { overflowWrap: "anywhere" },
  render: (a) => (
    <>
      {a.pageId ? <RouterLink {...pageLink(a.pageId)}>{a.pageTitle ?? a.pageId}</RouterLink> : <Muted component="span">{a.branchName ?? "—"}</Muted>}
      <StatusChip label={actionLabel(a)} size="small" sx={{ ml: 1 }} />
    </>
  ),
};

function Scheduled() {
  const scheduled = useQuery({ queryKey: ["schedule", "dashboard"], queryFn: () => api.listSchedule({ status: "scheduled" }) });
  const all = scheduled.data?.actions;
  const rows = all?.slice(0, DASHBOARD_ROWS);
  const more = all && all.length > DASHBOARD_ROWS ? all.length - DASHBOARD_ROWS : 0;
  return (
    <Block
      title="予約公開"
      help={`これから実行される公開・非公開化などの予約です。実行が早い順に、${DASHBOARD_ROWS} 件まで出します。変更や取り消しは、ページの「公開」から行います。`}
      link={
        <RouterLink {...screenLink("/w/$wikiKey/calendar")} underline="always">
          編集カレンダーを開く
        </RouterLink>
      }
    >
      <DataList
        label="予約公開の一覧"
        columns={[scheduledTitleColumn, runAtColumn]}
        rows={rows}
        rowKey={(a) => a.id}
        rowLink={(a) => (a.pageId ? pageLink(a.pageId) : undefined)}
        error={scheduled.error}
        empty="予約はありません。ページの「公開」の「予約」から入れられます。"
        skeletonRows={3}
      />
      {more > 0 && <Muted sx={{ mt: 1 }}>ほか {more} 件は、編集カレンダーで見られます。</Muted>}
    </Block>
  );
}

function ViewsSummary() {
  const analytics = useQuery({ queryKey: ["analytics", DAYS], queryFn: () => api.analytics(DAYS), staleTime: 60_000 });
  return (
    <Block
      title="閲覧数"
      help={`公開サイトの直近 ${DAYS} 日間の閲覧数（Google Analytics）です。昨日までの数字で、同じ期間は1時間のあいだ使い回します。期間の切り替えや、よく読まれた記事・流入元・検索の数字は「アクセス解析」で見られます。`}
      link={
        <RouterLink {...screenLink("/w/$wikiKey/analytics")} underline="always">
          アクセス解析を開く
        </RouterLink>
      }
    >
      {analytics.error && <Alert severity="error">{errorMessage(analytics.error)}</Alert>}
      {analytics.isPending && (
        <LoadingRegion>
          <Skeleton variant="text" width={160} sx={{ fontSize: "2.25rem" }} />
        </LoadingRegion>
      )}
      {analytics.data && <ViewsBody data={analytics.data} />}
    </Block>
  );
}

function ViewsBody({ data }: { data: WikiAnalytics }) {
  const { ga } = data;
  if (data.serviceAccount !== "ready" || ga.status === "unset") {
    return (
      <Muted>
        Google Analytics につないでいないため、数字は出ません。つなぎ方は{" "}
        <RouterLink {...screenLink("/w/$wikiKey/analytics")} underline="always">
          アクセス解析
        </RouterLink>
        に書いてあります。
      </Muted>
    );
  }
  if (!ga.data) {
    const failure = ga.error ? failureText(ga.error, "ga") : null;
    return <Muted sx={{ color: "text.primary" }}>{failure ? `${failure.what}${failure.fix}` : "数字を取れませんでした。しばらく待ってから、アクセス解析で取り直してください。"}</Muted>;
  }
  return <ViewsNumbers data={ga.data} stale={ga.status === "error"} fetchedAt={ga.fetchedAt} />;
}

function ViewsNumbers({ data, stale, fetchedAt }: { data: GaAnalytics; stale: boolean; fetchedAt: string | null }) {
  if (gaIsEmpty(data)) return <Muted>まだ数字がありません。つないでから数字が出るまで、数時間かかります。</Muted>;
  const change = changeLabel(data.totals.views, data.previous.views);
  const channels = donutSlices(data.channels.map((c) => ({ label: channelLabel(c.channel), value: c.sessions })));
  return (
    <Stack spacing={0.5}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 3, rowGap: 0.5 }}>
        <Box>
          <Typography component="span" sx={{ fontSize: "2.25rem", fontWeight: 600, lineHeight: 1.2, ...numberSx }}>
            {count(data.totals.views)}
          </Typography>
          <Muted component="span"> 回の閲覧（直近 {DAYS} 日間）</Muted>
        </Box>
        <Muted component="span" sx={numberSx}>
          前の {DAYS} 日間より {change.text}
        </Muted>
        <Muted component="span" sx={numberSx}>
          ユーザー {count(data.totals.users)} 人
        </Muted>
      </Box>
      {channels.length > 0 && (
        <Box sx={{ pt: 1.5 }}>
          <Muted sx={{ fontSize: "0.75rem", mb: 1 }}>流入元の内訳（どこから来たか。セッション数）</Muted>
          <DonutChart slices={channels} ariaLabel="流入元の内訳" unit="" totalLabel="セッション" />
        </Box>
      )}
      {stale && fetchedAt && <Muted>Google から取り直せなかったため、{formatDateTime(fetchedAt)} に取れた数字です。</Muted>}
    </Stack>
  );
}
