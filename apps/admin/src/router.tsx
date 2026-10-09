import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { PageBody } from "./components/ui";
import { Layout } from "./routes/Layout";
import { CalendarPage } from "./routes/CalendarPage";
import { EditorPage } from "./routes/EditorPage";
import { HistoryPage } from "./routes/HistoryPage";
import { PagesPage } from "./routes/PagesPage";

const rootRoute = createRootRoute({ component: Layout });

/** 一覧・設定系の画面は余白つきの枠に入れる（エディタは画面いっぱいを使う）。 */
const padded = (Page: ComponentType) => () => (
  <PageBody>
    <Page />
  </PageBody>
);

const pagesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: padded(PagesPage) });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pages/$pageId",
  component: function Editor() {
    const { pageId } = editorRoute.useParams();
    return <EditorPage key={pageId} pageId={pageId} />;
  },
});
const calendarRoute = createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: padded(CalendarPage) });
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/history", component: padded(HistoryPage) });
// ログイン失敗時のリダイレクト先。Layout がログイン画面を出す
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: padded(PagesPage) });

const routeTree = rootRoute.addChildren([pagesRoute, editorRoute, calendarRoute, historyRoute, loginRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
