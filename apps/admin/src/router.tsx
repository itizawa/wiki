import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./routes/Layout";
import { EditorPage } from "./routes/EditorPage";
import { HistoryPage } from "./routes/HistoryPage";
import { PagesPage } from "./routes/PagesPage";
import { TreePage } from "./routes/TreePage";

const rootRoute = createRootRoute({ component: Layout });

const pagesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: PagesPage });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pages/$pageId",
  component: function Editor() {
    const { pageId } = editorRoute.useParams();
    return <EditorPage key={pageId} pageId={pageId} />;
  },
});
const treeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tree", component: TreePage });
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/history", component: HistoryPage });
// ログイン失敗時のリダイレクト先。Layout がログイン画面を出す
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: PagesPage });

const routeTree = rootRoute.addChildren([pagesRoute, editorRoute, treeRoute, historyRoute, loginRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
