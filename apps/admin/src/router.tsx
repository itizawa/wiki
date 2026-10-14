import Box from "@mui/material/Box";
import { createRootRoute, createRoute, createRouter, redirect, useRouterState } from "@tanstack/react-router";
import { DEFAULT_ANALYTICS_DAYS, isAnalyticsDays, X_CONNECT_RESULTS, type AnalyticsDays, type XConnectResult } from "@wiki/shared";
import type { EditRequestListStatus } from "@wiki/shared";
import { useCallback, type ComponentType } from "react";
import { PageBody, SkeletonEditor } from "./components/ui";
import { AppearancePage } from "./routes/AppearancePage";
import { Home, mainProps, mainSx, Root, SkipLink } from "./routes/Layout";
import { lazyScreen, ScreenSkeleton } from "./routes/lazyScreen";
import { DashboardPage } from "./routes/DashboardPage";
import { ConnectionsPage } from "./routes/ConnectionsPage";
import { ConsentPage } from "./routes/ConsentPage";
import { EditRequestListPage } from "./routes/EditRequestListPage";
import { GeneralSettingsPage } from "./routes/GeneralSettingsPage";
import { GlobalAdminLayout } from "./routes/GlobalAdminLayout";
import { InvitePage } from "./routes/InvitePage";
import { MembersPage } from "./routes/MembersPage";
import { NotFoundPage } from "./routes/NotFoundPage";
import { CostsPage } from "./routes/CostsPage";
import { RoutinesPage } from "./routes/RoutinesPage";
import { OwnersPage } from "./routes/OwnersPage";
import { PagesPage } from "./routes/PagesPage";
import { FIRST_WIKI } from "./lib/wiki";
import { TrashPage } from "./routes/TrashPage";
import { SearchPage } from "./routes/SearchPage";
import { SettingsPage } from "./routes/SettingsPage";
import { SnsSettingsPage } from "./routes/SnsSettingsPage";
import { WorkflowDetailPage } from "./routes/WorkflowDetailPage";
import { WorkflowsPage } from "./routes/WorkflowsPage";
import { TagSettingsPage } from "./routes/TagSettingsPage";
import { WikiLayout } from "./routes/WikiLayout";
import { WikiSettingsLayout } from "./routes/WikiSettingsLayout";
import { WikisPage } from "./routes/WikisPage";

// 重い画面は、開くときに読み込む（最初に読む JS から外す）。エディタ（TipTap・ProseMirror）を使う画面は、すべてここに置く。
// 読み込みのあいだは、その画面が自分で出す読み込み中の表示と同じ形を出す
const page = { fallback: <ScreenSkeleton /> };
const fullHeight = { fallback: <SkeletonEditor />, bare: true };
const EditorPage = lazyScreen(() => import("./routes/EditorPage"), "EditorPage", fullHeight);
const EditRequestsPage = lazyScreen(() => import("./routes/EditRequestsPage"), "EditRequestsPage", fullHeight);
const TemplatesPage = lazyScreen(() => import("./routes/TemplatesPage"), "TemplatesPage", page);
const TemplateEditorPage = lazyScreen(() => import("./routes/TemplatesPage"), "TemplateEditorPage", fullHeight);
const HomeSettingsPage = lazyScreen(() => import("./routes/HomeSettingsPage"), "HomeSettingsPage", page);
const AnalyticsPage = lazyScreen(() => import("./routes/AnalyticsPage"), "AnalyticsPage", page);
const AuditLogPage = lazyScreen(() => import("./routes/AuditLogPage"), "AuditLogPage", page);
const CalendarPage = lazyScreen(() => import("./routes/CalendarPage"), "CalendarPage", page);

// ログインの確認までを Root が行う。wiki の内容は、すべて /w/{key}/... の下にある
const rootRoute = createRootRoute({ component: Root });

/** 一覧・設定系の画面は余白つきの枠に入れる（エディタは画面いっぱいを使う）。 */
const padded = (Page: ComponentType) => () => (
  <PageBody>
    <Page />
  </PageBody>
);

/** wiki の外の画面（サイドバーが無い）の枠。スキップリンクと本文（`main`）を付ける。 */
const standalone = (Page: ComponentType) => () => (
  <>
    <SkipLink />
    <Box {...mainProps} sx={mainSx}>
      <PageBody>
        <Page />
      </PageBody>
    </Box>
  </>
);

// `/` は最後に開いていた wiki へ移す。使用中の wiki が無ければ「wiki を作成する」だけを出す
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
// ログイン失敗時のリダイレクト先。Root がログイン画面を出す
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Home });
// 「全体の管理」：wiki をまたぐオーナー向けの3画面の共通の枠（「wiki の画面に戻る」・見出し・タブ）。URL は持たない
const globalAdminRoute = createRoute({ getParentRoute: () => rootRoute, id: "global-admin", component: standalone(GlobalAdminLayout) });
// wiki の一覧・作成・アーカイブ（オーナーだけ）。wiki が1つも無くても開けるよう、/w/ の外に置く
const wikisRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/wikis", component: WikisPage });
// オーナーの追加・解除（オーナーだけ）
const ownersRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/owners", component: OwnersPage });
// すべての wiki と全体にかかわる監査ログ（オーナーだけ）
const auditAllRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/audit", component: () => <AuditLogPage scope="all" /> });
// 運用コスト（サービスごとの使用量。オーナーだけ）
const costsRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/costs", component: CostsPage });
// Routine（ワークフローが呼ぶ Claude Routine の登録。オーナーだけ）
const routinesRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/routines", component: RoutinesPage });
// 招待リンク（/invite#{値}）。ログインしていなくても開ける（Root がログインの確認を飛ばす）。
// 値はフラグメントに置き、サーバーへのリクエストの URL に載せない（アクセスログに残さない）
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  component: function Invite() {
    const hash = useRouterState({ select: (s) => s.location.hash });
    return <InvitePage token={decodeURIComponent(hash.replace(/^#/, ""))} />;
  },
});
// 外部のアプリ（MCP）：接続の依頼への同意と、与えた許可の一覧。wiki をまたぐので /w/ の外に置く
const consentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/consent", component: ConsentPage });
const connectionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/connections", component: standalone(ConnectionsPage) });

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$wikiKey",
  notFoundComponent: NotFoundPage,
  component: function Wiki() {
    const { wikiKey } = wikiRoute.useParams();
    // wiki を切り替えたら、画面の状態と読み込み済みのデータを持ち越さない
    return <WikiLayout key={wikiKey} wikiKey={wikiKey} />;
  },
});
// wiki のトップ：最近更新したページ・下書き・予約公開・閲覧数の要約。全ページの一覧は /pages
const dashboardRoute = createRoute({ getParentRoute: () => wikiRoute, path: "/", component: padded(DashboardPage) });
const pagesRoute = createRoute({ getParentRoute: () => wikiRoute, path: "pages", component: padded(PagesPage) });
const editorRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "pages/$pageId",
  // ?history={版のID}：版履歴を開き、その版を選んだ状態。再読み込みや URL の共有で同じ版が開く
  validateSearch: (search: Record<string, unknown>): { history?: string } =>
    typeof search.history === "string" && search.history !== "" ? { history: search.history } : {},
  component: function Editor() {
    const { pageId } = editorRoute.useParams();
    const { history } = editorRoute.useSearch();
    return <EditorPage key={pageId} pageId={pageId} historyVersionId={history ?? null} />;
  },
});
// ページの編集リクエストのレビュー画面（最新の版を読み取り専用で出し、提案を採用・却下する）
const editRequestsRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "pages/$pageId/requests",
  component: function EditRequests() {
    const { pageId } = editRequestsRoute.useParams();
    return <EditRequestsPage key={pageId} pageId={pageId} />;
  },
});
// この wiki の編集リクエストの一覧。?status=done：完了したもの（既定の「未対応」は付けない）。再読み込みや URL の共有で同じ絞り込みが開く
const editRequestListRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "requests",
  validateSearch: (search: Record<string, unknown>): { status?: "done" } => (search.status === "done" ? { status: "done" } : {}),
  component: function EditRequestList() {
    const { status = "open" } = editRequestListRoute.useSearch();
    const navigate = editRequestListRoute.useNavigate();
    return (
      <PageBody>
        <EditRequestListPage status={status} onStatusChange={(next: EditRequestListStatus) => void navigate({ search: next === "done" ? { status: next } : {} })} />
      </PageBody>
    );
  },
});
const searchRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "search",
  validateSearch: (search: Record<string, unknown>): { q?: string } => (typeof search.q === "string" && search.q !== "" ? { q: search.q } : {}),
  component: function Search() {
    const { q = "" } = searchRoute.useSearch();
    const navigate = searchRoute.useNavigate();
    return (
      <PageBody>
        {/* 打つたびに履歴を増やさない */}
        <SearchPage q={q} onChange={(next) => void navigate({ search: next ? { q: next } : {}, replace: true })} />
      </PageBody>
    );
  },
});
const calendarRoute = createRoute({ getParentRoute: () => wikiRoute, path: "calendar", component: padded(CalendarPage) });
// アクセス解析（Google Analytics とサーチコンソールの数字）。?days=7|90：期間（既定の28日は付けない）。再読み込みや URL の共有で同じ期間が開く
const analyticsRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "analytics",
  validateSearch: (search: Record<string, unknown>): { days?: AnalyticsDays } => {
    const days = Number(search.days);
    return isAnalyticsDays(days) && days !== DEFAULT_ANALYTICS_DAYS ? { days } : {};
  },
  component: function Analytics() {
    const { days = DEFAULT_ANALYTICS_DAYS } = analyticsRoute.useSearch();
    const navigate = analyticsRoute.useNavigate();
    return (
      <PageBody>
        <AnalyticsPage days={days} onDaysChange={(next) => void navigate({ search: next === DEFAULT_ANALYTICS_DAYS ? {} : { days: next }, replace: true })} />
      </PageBody>
    );
  },
});
const templatesRoute = createRoute({ getParentRoute: () => wikiRoute, path: "templates", component: padded(TemplatesPage) });
const templateEditorRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "templates/$templateId",
  component: function TemplateEditor() {
    const { templateId } = templateEditorRoute.useParams();
    return <TemplateEditorPage key={templateId} templateId={templateId} />;
  },
});
// ワークフロー。設定とは独立した画面で、サイドバーから開く。管理者だけ。一覧と、1つのワークフロー（ブロックと実行の履歴）の詳細
const workflowsRoute = createRoute({ getParentRoute: () => wikiRoute, path: "workflows", component: padded(WorkflowsPage) });
const workflowDetailRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "workflows/$workflowId",
  component: padded(function WorkflowDetail() {
    const { workflowId } = workflowDetailRoute.useParams();
    return <WorkflowDetailPage key={workflowId} workflowId={workflowId} />;
  }),
});
const trashRoute = createRoute({ getParentRoute: () => wikiRoute, path: "trash", component: padded(TrashPage) });

// wiki ごとの設定。見出しとタブ（WikiSettingsLayout）の下に、タブごとの画面を出す。タブごとに URL を分ける
const settingsRoute = createRoute({ getParentRoute: () => wikiRoute, path: "settings", component: padded(WikiSettingsLayout) });
// 一般：表示名と画像（変えるのはオーナーだけ）
const settingsGeneralRoute = createRoute({ getParentRoute: () => settingsRoute, path: "/", component: GeneralSettingsPage });
// 公開サイトの外観（管理者だけ）
const appearanceRoute = createRoute({ getParentRoute: () => settingsRoute, path: "appearance", component: AppearancePage });
// 公開サイトのトップに出す自由記述（管理者だけ）
const siteHomeRoute = createRoute({ getParentRoute: () => settingsRoute, path: "home", component: HomeSettingsPage });
// 公開サイトの連携（GA・サーチコンソール）。読むのはだれでも、変えるのはオーナーだけ
const integrationsRoute = createRoute({ getParentRoute: () => settingsRoute, path: "integrations", component: SettingsPage });
// SNS のアカウントとの連携（管理者だけ）。X の認可の画面から戻ってきたときは、結果が `?x=` に付く
const snsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "sns",
  validateSearch: (search: Record<string, unknown>): { x?: XConnectResult } => {
    const x = X_CONNECT_RESULTS.find((r) => r === search.x);
    return x ? { x } : {};
  },
  component: function SnsScreen() {
    const { x } = snsRoute.useSearch();
    const navigate = snsRoute.useNavigate();
    const clear = useCallback(() => void navigate({ search: {}, replace: true }), [navigate]);
    return <SnsSettingsPage result={x} onResultRead={clear} />;
  },
});
// タグ管理（管理用タグ）。管理者だけ
const tagsRoute = createRoute({ getParentRoute: () => settingsRoute, path: "tags", component: TagSettingsPage });
// メンバー。一覧はだれでも、変えるのは管理者だけ
const membersRoute = createRoute({ getParentRoute: () => settingsRoute, path: "members", component: MembersPage });
// この wiki の監査ログ（管理者だけ）
const auditRoute = createRoute({ getParentRoute: () => settingsRoute, path: "audit", component: () => <AuditLogPage scope="wiki" /> });

// 設定のタブにまとめる前の URL。ブックマークや共有したリンクを切らさないよう、新しいタブへ移す
const legacySettingsScreen = (path: "members" | "audit" | "appearance" | "home") =>
  createRoute({
    getParentRoute: () => wikiRoute,
    path,
    beforeLoad: ({ params }) => {
      throw redirect({ to: `/w/$wikiKey/settings/${path}`, params: { wikiKey: params.wikiKey }, replace: true });
    },
  });

// ワークフローが設定のタブだった頃の URL。ブックマークや共有したリンクを切らさないよう、独立した画面へ移す
const legacyWorkflowsRoute = createRoute({
  getParentRoute: () => wikiRoute,
  path: "settings/workflows",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$wikiKey/workflows", params: { wikiKey: params.wikiKey }, replace: true });
  },
});

// wiki が1つだった頃の URL。その頃の内容は最初の wiki（key = wiki）にあるので、そこへ移す
const legacyEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pages/$pageId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$wikiKey/pages/$pageId", params: { wikiKey: FIRST_WIKI, pageId: params.pageId }, replace: true });
  },
});
const legacyScreen = (path: "/calendar", to: `/w/$wikiKey${typeof path}`) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: () => {
      throw redirect({ to, params: { wikiKey: FIRST_WIKI }, replace: true });
    },
  });

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  globalAdminRoute.addChildren([wikisRoute, ownersRoute, auditAllRoute, routinesRoute, costsRoute]),
  inviteRoute,
  consentRoute,
  connectionsRoute,
  wikiRoute.addChildren([
    dashboardRoute,
    pagesRoute,
    editorRoute,
    editRequestsRoute,
    editRequestListRoute,
    searchRoute,
    calendarRoute,
    analyticsRoute,
    templatesRoute,
    templateEditorRoute,
    trashRoute,
    workflowsRoute,
    workflowDetailRoute,
    settingsRoute.addChildren([settingsGeneralRoute, appearanceRoute, siteHomeRoute, integrationsRoute, snsRoute, tagsRoute, membersRoute, auditRoute]),
    legacySettingsScreen("members"),
    legacySettingsScreen("audit"),
    legacySettingsScreen("appearance"),
    legacySettingsScreen("home"),
    legacyWorkflowsRoute,
  ]),
  legacyEditorRoute,
  legacyScreen("/calendar", "/w/$wikiKey/calendar"),
]);

// 画面を移るとき、前の画面をフェードアウトさせ、次の画面をフェードインさせる（View Transitions API。見た目は theme.ts の MuiCssBaseline）。
// 同じ画面のままクエリ（タブ・絞り込み・検索語）だけが変わるときと、最初に開いたときはフェードさせない。
// それを見分ける仕組み（遷移の型）に対応していないブラウザでは、フェードそのものを使わない（ふつうに切り替わる）
const pageTransition =
  typeof CSS !== "undefined" && CSS.supports?.("selector(:active-view-transition-type(a))")
    ? { types: ({ fromLocation, pathChanged }: { fromLocation?: unknown; pathChanged: boolean }) => (fromLocation && pathChanged ? ["page"] : false) }
    : false;

export const router = createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage, defaultViewTransition: pageTransition });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
