import { createRootRoute, createRoute, createRouter, redirect, useRouterState } from "@tanstack/react-router";
import { DEFAULT_ANALYTICS_DAYS, isAnalyticsDays, type AnalyticsDays } from "@wiki/shared";
import type { ComponentType } from "react";
import { PageBody } from "./components/ui";
import { AppearancePage } from "./routes/AppearancePage";
import { HomeSettingsPage } from "./routes/HomeSettingsPage";
import { Home, Root } from "./routes/Layout";
import { AnalyticsPage } from "./routes/AnalyticsPage";
import { AuditLogPage } from "./routes/AuditLogPage";
import { CalendarPage } from "./routes/CalendarPage";
import { ConnectionsPage } from "./routes/ConnectionsPage";
import { ConsentPage } from "./routes/ConsentPage";
import { EditorPage } from "./routes/EditorPage";
import { GeneralSettingsPage } from "./routes/GeneralSettingsPage";
import { GlobalAdminLayout } from "./routes/GlobalAdminLayout";
import { HistoryPage } from "./routes/HistoryPage";
import { InvitePage } from "./routes/InvitePage";
import { MembersPage } from "./routes/MembersPage";
import { OwnersPage } from "./routes/OwnersPage";
import { PagesPage } from "./routes/PagesPage";
import { FIRST_WIKI } from "./lib/wiki";
import { TemplateEditorPage, TemplatesPage } from "./routes/TemplatesPage";
import { TrashPage } from "./routes/TrashPage";
import { SearchPage } from "./routes/SearchPage";
import { SettingsPage } from "./routes/SettingsPage";
import { WikiLayout } from "./routes/WikiLayout";
import { WikiSettingsLayout } from "./routes/WikiSettingsLayout";
import { WikisPage } from "./routes/WikisPage";

// ログインの確認までを Root が行う。wiki の内容は、すべて /w/{key}/... の下にある
const rootRoute = createRootRoute({ component: Root });

/** 一覧・設定系の画面は余白つきの枠に入れる（エディタは画面いっぱいを使う）。 */
const padded = (Page: ComponentType) => () => (
  <PageBody>
    <Page />
  </PageBody>
);

// `/` は最後に開いていた wiki へ移す。使用中の wiki が無ければ「wiki を作成する」だけを出す
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
// ログイン失敗時のリダイレクト先。Root がログイン画面を出す
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Home });
// 「全体の管理」：wiki をまたぐオーナー向けの3画面の共通の枠（「wiki の画面に戻る」・見出し・タブ）。URL は持たない
const globalAdminRoute = createRoute({ getParentRoute: () => rootRoute, id: "global-admin", component: padded(GlobalAdminLayout) });
// wiki の一覧・作成・アーカイブ（オーナーだけ）。wiki が1つも無くても開けるよう、/w/ の外に置く
const wikisRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/wikis", component: WikisPage });
// オーナーの追加・解除（オーナーだけ）
const ownersRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/owners", component: OwnersPage });
// すべての wiki と全体にかかわる監査ログ（オーナーだけ）
const auditAllRoute = createRoute({ getParentRoute: () => globalAdminRoute, path: "/audit", component: () => <AuditLogPage scope="all" /> });
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
const connectionsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/connections", component: padded(ConnectionsPage) });

const wikiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$wikiKey",
  component: function Wiki() {
    const { wikiKey } = wikiRoute.useParams();
    // wiki を切り替えたら、画面の状態と読み込み済みのデータを持ち越さない
    return <WikiLayout key={wikiKey} wikiKey={wikiKey} />;
  },
});
const pagesRoute = createRoute({ getParentRoute: () => wikiRoute, path: "/", component: padded(PagesPage) });
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
const historyRoute = createRoute({ getParentRoute: () => wikiRoute, path: "history", component: padded(HistoryPage) });
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

// wiki が1つだった頃の URL。その頃の内容は最初の wiki（key = wiki）にあるので、そこへ移す
const legacyEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pages/$pageId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$wikiKey/pages/$pageId", params: { wikiKey: FIRST_WIKI, pageId: params.pageId }, replace: true });
  },
});
const legacyScreen = (path: "/calendar" | "/history", to: `/w/$wikiKey${typeof path}`) =>
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
  globalAdminRoute.addChildren([wikisRoute, ownersRoute, auditAllRoute]),
  inviteRoute,
  consentRoute,
  connectionsRoute,
  wikiRoute.addChildren([
    pagesRoute,
    editorRoute,
    searchRoute,
    calendarRoute,
    analyticsRoute,
    templatesRoute,
    templateEditorRoute,
    historyRoute,
    trashRoute,
    settingsRoute.addChildren([settingsGeneralRoute, appearanceRoute, siteHomeRoute, integrationsRoute, membersRoute, auditRoute]),
    legacySettingsScreen("members"),
    legacySettingsScreen("audit"),
    legacySettingsScreen("appearance"),
    legacySettingsScreen("home"),
  ]),
  legacyEditorRoute,
  legacyScreen("/calendar", "/w/$wikiKey/calendar"),
  legacyScreen("/history", "/w/$wikiKey/history"),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
