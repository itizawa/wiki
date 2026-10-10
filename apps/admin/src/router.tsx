import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { PageBody } from "./components/ui";
import { Home, Root } from "./routes/Layout";
import { CalendarPage } from "./routes/CalendarPage";
import { EditorPage } from "./routes/EditorPage";
import { HistoryPage } from "./routes/HistoryPage";
import { InvitePage } from "./routes/InvitePage";
import { MembersPage } from "./routes/MembersPage";
import { OwnersPage } from "./routes/OwnersPage";
import { PagesPage } from "./routes/PagesPage";
import { FIRST_WIKI } from "./lib/wiki";
import { RulesPage } from "./routes/RulesPage";
import { TemplateEditorPage, TemplatesPage } from "./routes/TemplatesPage";
import { SearchPage } from "./routes/SearchPage";
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
// オーナーの追加・解除（オーナーだけ）
const ownersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/owners", component: padded(OwnersPage) });
// 招待リンク。ログインしていなくても開ける（Root がログインの確認を飛ばす）
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: function Invite() {
    const { token } = inviteRoute.useParams();
    return <InvitePage token={token} />;
  },
});

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
  component: function Editor() {
    const { pageId } = editorRoute.useParams();
    return <EditorPage key={pageId} pageId={pageId} />;
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
const membersRoute = createRoute({ getParentRoute: () => wikiRoute, path: "members", component: padded(MembersPage) });

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
  ownersRoute,
  inviteRoute,
  wikiRoute.addChildren([pagesRoute, editorRoute, searchRoute, calendarRoute, rulesRoute, templatesRoute, templateEditorRoute, historyRoute, membersRoute]),
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
