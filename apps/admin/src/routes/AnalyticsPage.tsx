import { CircleCheck, CircleDashed, Minus, RefreshCw, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANALYTICS_DAYS,
  type AnalyticsDays,
  type AnalyticsPageRef,
  type AnalyticsSource,
  type DayRange,
  type GaAnalytics,
  type SearchConsoleAnalytics,
  type SearchMetrics,
  type SitemapStatus,
  type WikiAnalytics,
} from "@wiki/shared";
import { useEffect, useState, type ReactNode } from "react";
import { DailyBars } from "../components/DailyBars";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { LoadingRegion, Mono, Muted, RouterLink, Row, Section, SkeletonSection } from "../components/ui";
import {
  changeLabel,
  channelLabel,
  EMPTY_NOTE,
  failureText,
  gaIsEmpty,
  gaReportsUrl,
  percentLabel,
  positionLabel,
  searchConsoleIsEmpty,
  searchConsoleUrl,
  secondsUntil,
  SERVICE_ACCOUNT_HELP,
  targetName,
  type AnalyticsTarget,
} from "../lib/analytics";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, formatDay } from "../lib/format";
import { pageLink, screenLink, useWiki } from "../lib/wiki";
import { ExternalSite } from "./SettingsPage";
import { useScreenTitle } from "../lib/documentTitle";

const textSx = { maxWidth: 680 } as const;
const numberSx = { fontVariantNumeric: "tabular-nums" } as const;
const count = (n: number) => n.toLocaleString("ja-JP");

/** `/w/{key}/analytics`：Google Analytics とサーチコンソールの数字と、連携の状態。細かい分析は Google の画面で行う。 */
export function AnalyticsPage({ days, onDaysChange }: { days: AnalyticsDays; onDaysChange: (days: AnalyticsDays) => void }) {
  useScreenTitle("アクセス解析");
  const { wiki } = useWiki();
  const qc = useQueryClient();
  const analytics = useQuery({ queryKey: ["analytics", days], queryFn: () => api.analytics(days), staleTime: 60_000 });
  const refresh = useMutation({
    mutationFn: () => api.refreshAnalytics(days),
    onSuccess: (data) => qc.setQueryData(["analytics", days], data),
  });
  const data = analytics.data;
  // どちらもつないでいなければ、数字の枠は出さず、手順への案内だけにする
  const notConnected = data !== undefined && (data.serviceAccount !== "ready" || (data.ga.status === "unset" && data.searchConsole.status === "unset"));

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          help={
            <>
              「{wiki.name}」の公開サイト（{wiki.origin}）の、Google Analytics とサーチコンソールの数字です。細かい分析は、それぞれの Google の画面で行えます。
            </>
          }
          sx={{ mb: 0.5 }}
        >
          アクセス解析
        </HelpHeading>
        {!notConnected && (
          <Controls days={days} onDaysChange={onDaysChange} data={data} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} refreshed={refresh.isSuccess} refreshError={refresh.error} />
        )}
      </Section>

      {analytics.error && <Alert severity="error">{errorMessage(analytics.error)}</Alert>}
      {analytics.isPending && <AnalyticsSkeleton />}
      {data && notConnected && <NotConnected data={data} />}
      {data && !notConnected && (
        <>
          <StatusSection data={data} />
          <GaSections source={data.ga} propertyId={data.ga.propertyId} days={days} />
          <SearchConsoleSection source={data.searchConsole} siteUrl={data.searchConsole.siteUrl} days={days} />
        </>
      )}
    </Stack>
  );
}

/** 期間の切り替え、取得した日時、「更新」。 */
function Controls(props: {
  days: AnalyticsDays;
  onDaysChange: (days: AnalyticsDays) => void;
  data: WikiAnalytics | undefined;
  refreshing: boolean;
  refreshed: boolean;
  refreshError: unknown;
  onRefresh: () => void;
}) {
  const { data } = props;
  const [now, setNow] = useState(() => Date.now());
  const wait = secondsUntil(data?.refreshableAt ?? null, now);
  // 「更新」を押せるようになるまでの秒数を数える
  useEffect(() => {
    setNow(Date.now());
    if (!data?.refreshableAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.refreshableAt]);

  const fetched = [data?.ga.fetchedAt, data?.searchConsole.fetchedAt].filter((v): v is string => typeof v === "string").sort();
  const latest = fetched.at(-1);
  return (
    <Stack spacing={0.75} sx={{ mt: 2 }}>
      <Row spacing={1.5}>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={props.days}
          aria-label="期間"
          // 選んでいるものをもう一度押しても、外さない
          onChange={(_, next: AnalyticsDays | null) => next !== null && props.onDaysChange(next)}
        >
          {ANALYTICS_DAYS.map((d) => (
            <ToggleButton key={d} value={d} sx={{ px: 1.5 }}>
              {d}日間
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button variant="outlined" startIcon={<RefreshCw size={16} />} disabled={!data || props.refreshing || wait > 0} onClick={props.onRefresh}>
          {props.refreshing ? "取り直しています…" : "数字を取り直す"}
        </Button>
        {latest && <Muted>{formatDateTime(latest)} に取得</Muted>}
      </Row>
      {/* 結果と、押せない理由は、押したボタンのそばに出す */}
      <Muted role="status" sx={textSx}>
        {wait > 0
          ? `${props.refreshed ? "Google から取り直しました。" : ""}取り直しは1分おきです（あと ${wait} 秒で押せます）。`
          : "昨日までの数字です。同じ期間は1時間のあいだ、取ったものを使い回します。"}
      </Muted>
      {props.refreshError != null && <Alert severity="error">{errorMessage(props.refreshError)}</Alert>}
    </Stack>
  );
}

/** 読み込み中。できあがる画面（連携の状態・概要・表）と同じ形の枠を出す。 */
function AnalyticsSkeleton() {
  return (
    <>
      <SkeletonSection lines={2} />
      <Section>
        <LoadingRegion>
          <Skeleton variant="text" width="32%" sx={{ fontSize: "1.1rem" }} />
          <Box sx={{ display: "flex", gap: 4, my: 1 }}>
            <Skeleton variant="text" width={96} sx={{ fontSize: "2.25rem" }} />
            <Skeleton variant="text" width={96} sx={{ fontSize: "2.25rem" }} />
          </Box>
          <Skeleton variant="rounded" height={64} />
        </LoadingRegion>
      </Section>
      <SkeletonSection lines={5} />
      <SkeletonSection lines={5} />
    </>
  );
}

const stepsSx = { m: 0, mt: 1.5, pl: 2.75, fontSize: "0.9rem", "& > li": { mb: 0.75 }, ...textSx } as const;

/** 「設定」の「Google 連携」タブ（GA・サーチコンソール）へのリンク */
function SettingsLink({ children = "「設定」を開く" }: { children?: ReactNode }) {
  return (
    <RouterLink {...screenLink("/w/$wikiKey/settings/integrations")} underline="always">
      {children}
    </RouterLink>
  );
}

/** まだつないでいないとき。数字の枠の代わりに、何を設定すれば使えるようになるかを出す。 */
function NotConnected({ data }: { data: WikiAnalytics }) {
  return (
    <Section>
      <Row sx={{ mb: 0.5 }}>
        <CircleDashed size={18} aria-hidden />
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          まだつないでいません
        </Typography>
      </Row>
      {data.serviceAccount === "ready" ? (
        <>
          <Muted sx={textSx}>この wiki は、まだ Google Analytics にもサーチコンソールにもつないでいません。次の順で、数字が出るようになります。</Muted>
          <Box component="ol" sx={stepsSx}>
            <li>
              <SettingsLink /> を開き、Google Analytics の「プロパティ ID」を入れて保存します（オーナーだけが変えられます）。
            </li>
            <li>「設定」に出ているサービスアカウントのメールアドレスを、GA のプロパティに「閲覧者」として、サーチコンソールのプロパティにユーザーとして足します。</li>
            <li>「設定」の「接続を確かめる」で、つながったことを確かめます。片方だけつないでも、つないだ方の数字が出ます。</li>
          </Box>
        </>
      ) : (
        <>
          <Muted sx={textSx}>
            {data.serviceAccount === "invalid"
              ? "Google の数字を読むための鍵が登録されていますが、鍵として読めません。Google Cloud でダウンロードした JSON を、そのまま登録し直してください（下の 3）。"
              : "この管理画面には、Google の数字を読むための鍵（サービスアカウント）が、まだ登録されていません。次の順で、使えるようになります。ほかの画面は、今までどおり使えます。"}
            <HelpTip about="鍵の登録">{SERVICE_ACCOUNT_HELP}</HelpTip>
          </Muted>
          <Box component="ol" sx={stepsSx}>
            <li>
              <ExternalSite href="https://console.cloud.google.com/apis/library">Google Cloud</ExternalSite> のプロジェクトで、「Google Analytics Data API」と「Google Search Console API」を有効にします。
            </li>
            <li>同じプロジェクトでサービスアカウントを作り、鍵（JSON）を作ってダウンロードします。</li>
            <li>
              JSON の中身を、そのままサーバーの設定に登録し、Actions の「Deploy」を実行します（登録先の名前は、上の「i」にあります）。
            </li>
            <li>
              この wiki の <SettingsLink /> で、GA のプロパティ ID を入れ、サービスアカウントを GA とサーチコンソールに足します。
            </li>
          </Box>
          <Muted sx={{ ...textSx, mt: 1 }}>1〜3 は、この管理画面を運用している人が1回だけ行います（リポジトリの README「アクセス解析」に、くわしい手順があります）。</Muted>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 連携の状態
// ---------------------------------------------------------------------------

const STATUS = {
  connected: { label: "接続済み", color: "success.main", icon: <CircleCheck size={16} aria-hidden /> },
  unset: { label: "未設定", color: "text.secondary", icon: <CircleDashed size={16} aria-hidden /> },
  error: { label: "エラー", color: "error.main", icon: <TriangleAlert size={16} aria-hidden /> },
} as const;

/** 状態は、色だけでなく印と言葉でも示す。 */
function StatusLabel({ status }: { status: AnalyticsSource<unknown>["status"] }) {
  const s = STATUS[status];
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: s.color, fontSize: "0.875rem", fontWeight: 600 }}>
      {s.icon}
      {s.label}
    </Box>
  );
}

const UNSET_NOTE: Record<AnalyticsTarget, string> = {
  ga: "プロパティ ID が、まだ入っていません。プロパティ ID を入れ、サービスアカウントを GA に足すと、数字が出ます。",
  search_console: "サーチコンソールにこの公開サイトを登録し、サービスアカウントをユーザーとして足すと、数字が出ます。",
};

function StatusSection({ data }: { data: WikiAnalytics }) {
  return (
    <Section>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
        連携の状態
      </Typography>
      <Stack spacing={1.5} divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        <StatusRow target="ga" source={data.ga} />
        <StatusRow target="search_console" source={data.searchConsole}>
          {data.searchConsole.data && <SitemapLine sitemaps={data.searchConsole.data.sitemaps} siteUrl={data.searchConsole.siteUrl} />}
        </StatusRow>
      </Stack>
    </Section>
  );
}

function StatusRow({ target, source, children }: { target: AnalyticsTarget; source: AnalyticsSource<unknown>; children?: ReactNode }) {
  const failure = source.error ? failureText(source.error, target) : null;
  return (
    <Box>
      <Row>
        <Typography component="h4" sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>
          {targetName(target)}
        </Typography>
        <StatusLabel status={source.status} />
        {source.status === "connected" && source.fetchedAt && <Muted>{formatDateTime(source.fetchedAt)} に取得</Muted>}
      </Row>
      {source.status === "unset" && (
        <Muted sx={{ ...textSx, mt: 0.5 }}>
          {UNSET_NOTE[target]} <SettingsLink>「設定」で手順を見る</SettingsLink>
        </Muted>
      )}
      {failure && (
        <Muted sx={{ ...textSx, mt: 0.5, color: "text.primary" }}>
          {failure.what}
          {failure.fix} <SettingsLink>「設定」で確かめる</SettingsLink>
          {source.fetchedAt && `（下の数字は、最後に取れた ${formatDateTime(source.fetchedAt)} 時点のものです）`}
        </Muted>
      )}
      {children}
    </Box>
  );
}

/** サーチコンソールに送ったサイトマップの状態。 */
function SitemapLine({ sitemaps, siteUrl }: { sitemaps: SitemapStatus[] | null; siteUrl: string }) {
  const link = <ExternalSite href={searchConsoleUrl(siteUrl, "sitemaps")}>サーチコンソールの「サイトマップ」</ExternalSite>;
  if (sitemaps === null) return <Muted sx={{ mt: 0.5 }}>サイトマップの状態は、取れませんでした。{link}で見られます。</Muted>;
  if (sitemaps.length === 0) {
    return (
      <Muted sx={{ ...textSx, mt: 0.5 }}>
        サイトマップ：まだ送られていません。{link}で、<Mono>{siteUrl}sitemap.xml</Mono> を送ってください。
      </Muted>
    );
  }
  return (
    <Box sx={{ mt: 0.5 }}>
      {sitemaps.map((s) => (
        <Muted key={s.path} sx={textSx}>
          サイトマップ <Mono sx={{ wordBreak: "break-all" }}>{s.path}</Mono>：
          {s.isPending ? "処理を待っています" : s.errors > 0 ? "エラーがあります" : "受け付けられました"}（エラー {count(s.errors)} 件・警告 {count(s.warnings)} 件、
          {s.lastDownloaded ? `Google が最後に読んだのは ${formatDateTime(s.lastDownloaded)}` : "Google はまだ読んでいません"}）
        </Muted>
      ))}
      {sitemaps.some((s) => s.errors > 0) && <Muted>エラーの中身は、{link}で見られます。</Muted>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 部品
// ---------------------------------------------------------------------------

function SectionTitle({ children, link }: { children: ReactNode; link?: ReactNode }) {
  return (
    <Row sx={{ mb: 1, justifyContent: "space-between" }}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {children}
      </Typography>
      {link && <Box sx={{ fontSize: "0.875rem" }}>{link}</Box>}
    </Row>
  );
}

function Figure({ label, value, change }: { label: string; value: string; change?: { text: string; direction: "up" | "down" | "flat"; against: string } }) {
  const Icon = change?.direction === "up" ? TrendingUp : change?.direction === "down" ? TrendingDown : Minus;
  return (
    <div>
      <Muted sx={{ fontSize: "0.75rem" }}>{label}</Muted>
      <Typography sx={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.2, ...numberSx }}>{value}</Typography>
      {change && (
        // 増減は、色ではなく印と符号で示す（増えるのが良いとは限らない数字もある）
        <Muted sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem" }}>
          <Icon size={14} aria-hidden />
          {change.against}より {change.text}
        </Muted>
      )}
    </div>
  );
}

const figuresSx = { display: "flex", flexWrap: "wrap", columnGap: 5, rowGap: 2, mb: 2 } as const;
const chartsSx = { display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3 } as const;

function rangeLabel(range: DayRange | null): string {
  if (!range) return "";
  const year = new Date().getFullYear();
  return `${formatDay(range.start, year)}〜${formatDay(range.end, year)}`;
}

/** 記事の題名（管理画面の記事へのリンク）。この wiki の記事に結びつかないパスは、パスのまま出す。 */
function PageCell({ page }: { page: AnalyticsPageRef }) {
  if (page.pageId) {
    return (
      <RouterLink {...pageLink(page.pageId)} underline="always">
        {page.title || "（無題）"}
      </RouterLink>
    );
  }
  return (
    <>
      <Mono sx={{ fontSize: "0.875rem", wordBreak: "break-all" }}>{page.path}</Mono>
      {page.path === "/" && <Muted component="span">（トップページ）</Muted>}
    </>
  );
}

/** 連携のまとまりの、数字の代わりに出すもの（未設定・1回も取れていないエラー）。出すものが無ければ null */
function SourceNotice({ source, target }: { source: AnalyticsSource<unknown>; target: AnalyticsTarget }) {
  if (source.status === "unset") {
    return (
      <Muted sx={textSx}>
        <StatusLabel status="unset" /> {UNSET_NOTE[target]} <SettingsLink>「設定」で手順を見る</SettingsLink>
      </Muted>
    );
  }
  if (!source.error) return null;
  // 理由と直し方は、上の「連携の状態」に出している
  return source.data && source.fetchedAt ? (
    <Alert severity="warning" sx={{ mb: 2 }}>
      Google から取り直せませんでした。下は、最後に取れた {formatDateTime(source.fetchedAt)} 時点の数字です。理由と直し方は、上の「連携の状態」にあります。
    </Alert>
  ) : (
    <Alert severity="error">数字を取れませんでした。理由と直し方は、上の「連携の状態」にあります。</Alert>
  );
}

// ---------------------------------------------------------------------------
// Google Analytics
// ---------------------------------------------------------------------------

function GaSections({ source, propertyId, days }: { source: AnalyticsSource<GaAnalytics>; propertyId: string | null; days: AnalyticsDays }) {
  const link = propertyId ? <ExternalSite href={gaReportsUrl(propertyId)}>Google Analytics で開く</ExternalSite> : undefined;
  const data = source.data;
  return (
    <>
      <Section>
        <SectionTitle link={link}>Google Analytics の概要</SectionTitle>
        <SourceNotice source={source} target="ga" />
        {data && <GaOverview data={data} days={days} />}
      </Section>
      {data && !gaIsEmpty(data) && (
        <>
          <Section>
            <SectionTitle link={link}>よく読まれた記事</SectionTitle>
            <Muted sx={{ mb: 1 }}>表示回数の多い順（上位 {data.pages.length} 件）。題名を押すと、管理画面の記事を開きます。</Muted>
            <ScrollTable>
              <TableHead>
                <TableRow>
                  <TableCell>記事</TableCell>
                  <TableCell align="right">表示回数</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.pages.map((p) => (
                  <TableRow key={p.pageId ?? p.path}>
                    <TableCell>
                      <PageCell page={p} />
                    </TableCell>
                    <TableCell align="right" sx={numberSx}>
                      {count(p.views)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
          </Section>
          <Section>
            <SectionTitle link={link}>流入元</SectionTitle>
            <Muted sx={{ mb: 1 }}>どこから来たか（チャネル）ごとのセッション数です。</Muted>
            <Channels channels={data.channels} />
          </Section>
        </>
      )}
    </>
  );
}

function GaOverview({ data, days }: { data: GaAnalytics; days: AnalyticsDays }) {
  const against = `前の${days}日間`;
  return (
    <>
      {gaIsEmpty(data) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {EMPTY_NOTE}
        </Alert>
      )}
      <Box sx={figuresSx}>
        <Figure label="利用者数" value={count(data.totals.users)} change={{ ...changeLabel(data.totals.users, data.previous.users), against }} />
        <Figure label="表示回数" value={count(data.totals.views)} change={{ ...changeLabel(data.totals.views, data.previous.views), against }} />
      </Box>
      <Box sx={chartsSx}>
        <DailyBars days={data.daily.map((d) => ({ day: d.day, count: d.views }))} title="表示回数の日別" ariaLabel="日別の表示回数" unit="回" valueLabel="表示回数" />
        <DailyBars days={data.daily.map((d) => ({ day: d.day, count: d.users }))} title="利用者数の日別" ariaLabel="日別の利用者数" unit="人" valueLabel="利用者数" />
      </Box>
      <Muted sx={{ ...textSx, mt: 1, fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 0.25 }}>
        昨日までの{days}日間{data.range && `（${rangeLabel(data.range)}）`}
        <HelpTip about="Google Analytics の数字の数え方">
          日付の区切りは、GA のプロパティのタイムゾーン{data.timeZone && `（${data.timeZone}）`}に従います。日別の利用者数は、同じ人が別の日にも来ると、それぞれの日に数えるので、足しても期間の利用者数にはなりません。
        </HelpTip>
      </Muted>
    </>
  );
}

/** チャネルごとのセッション数。割合は棒で、数は数字で出す。 */
function Channels({ channels }: { channels: GaAnalytics["channels"] }) {
  const total = channels.reduce((n, c) => n + c.sessions, 0);
  return (
    <ScrollTable>
      <TableHead>
        <TableRow>
          <TableCell>チャネル</TableCell>
          <TableCell align="right">セッション数</TableCell>
          <TableCell align="right">割合</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {channels.map((c) => {
          const ratio = total > 0 ? c.sessions / total : 0;
          return (
            <TableRow key={c.channel}>
              <TableCell sx={{ width: "55%" }}>
                {channelLabel(c.channel)}
                <Box aria-hidden sx={{ mt: 0.5, height: 4, borderRadius: 2, bgcolor: "action.hover" }}>
                  <Box sx={{ width: `${ratio * 100}%`, height: "100%", borderRadius: 2, bgcolor: "primary.main" }} />
                </Box>
              </TableCell>
              <TableCell align="right" sx={numberSx}>
                {count(c.sessions)}
              </TableCell>
              <TableCell align="right" sx={numberSx}>
                {percentLabel(ratio)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </ScrollTable>
  );
}

/** 狭い画面では、表だけを横にスクロールさせる（画面全体を横にはみ出させない）。 */
function ScrollTable({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ overflowX: "auto" }}>
      {/* 見出しと数は折り返さない（狭い画面で、1文字ずつ縦に割れないように） */}
      <Table
        size="small"
        sx={{
          "& th, & td.MuiTableCell-alignRight": { whiteSpace: "nowrap" },
          // 横にスクロールしても、どの行かがわかるよう、最初の列は残す
          "& th:first-of-type, & td:first-of-type": { position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper" },
        }}
      >
        {children}
      </Table>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// サーチコンソール
// ---------------------------------------------------------------------------

function SearchConsoleSection({ source, siteUrl, days }: { source: AnalyticsSource<SearchConsoleAnalytics>; siteUrl: string; days: AnalyticsDays }) {
  const data = source.data;
  const link = source.status === "unset" ? undefined : <ExternalSite href={searchConsoleUrl(siteUrl)}>サーチコンソールで開く</ExternalSite>;
  const empty = data ? searchConsoleIsEmpty(data) : false;
  return (
    <Section>
      <SectionTitle link={link}>検索（Google サーチコンソール）</SectionTitle>
      <SourceNotice source={source} target="search_console" />
      {data && (
        <>
          {empty && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {EMPTY_NOTE}
            </Alert>
          )}
          <Box sx={figuresSx}>
            <Figure label="クリック数" value={count(data.totals.clicks)} />
            <Figure label="表示回数" value={count(data.totals.impressions)} />
            <Figure label="CTR（クリックされた割合）" value={percentLabel(data.totals.ctr)} />
            <Figure label="平均掲載順位" value={positionLabel(data.totals.position, data.totals.impressions)} />
          </Box>
          {data.daily.length > 0 && (
            <Box sx={chartsSx}>
              <DailyBars days={data.daily.map((d) => ({ day: d.day, count: d.clicks }))} title="クリック数の日別" ariaLabel="日別のクリック数" unit="回" valueLabel="クリック数" />
              <DailyBars days={data.daily.map((d) => ({ day: d.day, count: d.impressions }))} title="表示回数の日別" ariaLabel="日別の検索結果での表示回数" unit="回" valueLabel="表示回数" />
            </Box>
          )}
          <Muted sx={{ ...textSx, mt: 1, fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 0.25 }}>
            昨日までの{days}日間（{rangeLabel(data.range)}）
            <HelpTip about="サーチコンソールの数字の数え方">日付の区切りは太平洋時間です。サーチコンソールの数字は2〜3日遅れて出るので、終わりの数日は、まだ入っていません。</HelpTip>
          </Muted>
          {!empty && (
            <>
              <SearchTable title="検索キーワード" note={`クリック数の多い順（上位 ${data.queries.length} 件）`} first="キーワード" rows={data.queries.map((q) => ({ key: q.query, cell: q.query, ...q }))} />
              <SearchTable
                title="検索されたページ"
                note={`クリック数の多い順（上位 ${data.pages.length} 件）。題名を押すと、管理画面の記事を開きます。`}
                first="ページ"
                rows={data.pages.map((p) => ({ key: p.pageId ?? p.path, cell: <PageCell page={p} />, ...p }))}
              />
            </>
          )}
        </>
      )}
    </Section>
  );
}

function SearchTable({ title, note, first, rows }: { title: string; note: string; first: string; rows: ({ key: string; cell: ReactNode } & SearchMetrics)[] }) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography component="h4" sx={{ fontWeight: 600, fontSize: "0.9375rem" }}>
        {title}
      </Typography>
      <Muted sx={{ mb: 1 }}>{rows.length > 0 ? note : "この期間には、まだありません。"}</Muted>
      {rows.length > 0 && (
        <ScrollTable>
          <TableHead>
            <TableRow>
              <TableCell>{first}</TableCell>
              <TableCell align="right">クリック数</TableCell>
              <TableCell align="right">表示回数</TableCell>
              <TableCell align="right">CTR</TableCell>
              <TableCell align="right">平均掲載順位</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell sx={{ minWidth: 160 }}>{r.cell}</TableCell>
                <TableCell align="right" sx={numberSx}>
                  {count(r.clicks)}
                </TableCell>
                <TableCell align="right" sx={numberSx}>
                  {count(r.impressions)}
                </TableCell>
                <TableCell align="right" sx={numberSx}>
                  {percentLabel(r.ctr)}
                </TableCell>
                <TableCell align="right" sx={numberSx}>
                  {positionLabel(r.position, r.impressions)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      )}
    </Box>
  );
}
