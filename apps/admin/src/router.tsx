import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { PageBody } from "./components/ui";
import { Home, Root } from "./routes/Layout";
import { CalendarPage } from "./routes/CalendarPage";
import { ConnectionsPage } from "./routes/ConnectionsPage";
import { ConsentPage } from "./routes/ConsentPage";
import { EditorPage } from "./routes/EditorPage";
import { HistoryPage } from "./routes/HistoryPage";
import { PagesPage } from "./routes/PagesPage";
import { FIRST_WIKI } from "./lib/wiki";
import { RulesPage } from "./routes/RulesPage";
import { TemplateEditorPage, TemplatesPage } from "./routes/TemplatesPage";
import { TrashPage } from "./routes/TrashPage";
import { SearchPage } from "./routes/SearchPage";
import { SettingsPage } from "./routes/SettingsPage";
import { WikiLayout } from "./routes/WikiLayout";
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
// wiki の一覧・作成・アーカイブ（オーナーだけ）。wiki が1つも無くても開けるよう、/w/ の外に置く
const wikisRoute = createRoute({ getParentRoute: () => rootRoute, path: "/wikis", component: padded(WikisPage) });
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
const rulesRoute = createRoute({ getParentRoute: () => wikiRoute, path: "rules", component: padded(RulesPage) });
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
// wiki ごとの設定（公開サイトの連携）。読むのはだれでも、変えるのはオーナーだけ
const settingsRoute = createRoute({ getParentRoute: () => wikiRoute, path: "settings", component: padded(SettingsPage) });

// wiki が1つだった頃の URL。その頃の内容は最初の wiki（key = wiki）にあるので、そこへ移す
const legacyEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pages/$pageId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/w/$wikiKey/pages/$pageId", params: { wikiKey: FIRST_WIKI, pageId: params.pageId }, replace: true });
  },
});
const legacyScreen = (path: "/calendar" | "/rules" | "/history", to: `/w/$wikiKey${typeof path}`) =>
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
  wikisRoute,
  consentRoute,
  connectionsRoute,
  wikiRoute.addChildren([pagesRoute, editorRoute, searchRoute, calendarRoute, rulesRoute, templatesRoute, templateEditorRoute, historyRoute, trashRoute, settingsRoute]),
  legacyEditorRoute,
  legacyScreen("/calendar", "/w/$wikiKey/calendar"),
  legacyScreen("/rules", "/w/$wikiKey/rules"),
  legacyScreen("/history", "/w/$wikiKey/history"),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
