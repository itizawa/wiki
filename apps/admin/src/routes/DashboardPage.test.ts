import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setApiWiki } from "../lib/api";
import { allPagesLink } from "./DashboardPage";

/** 「すべてのページを見る」を、いま開いている wiki のもとで描いた `href`。 */
async function allPagesHref(wikiKey: string): Promise<string | undefined> {
  setApiWiki(wikiKey);
  const router = createRouter({
    routeTree: createRootRoute({ component: () => allPagesLink() }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  return html.match(/href="([^"]*)"/)?.[1];
}

describe("ダッシュボードの「すべてのページを見る」", () => {
  it("開いている wiki のページの一覧へ移る（モジュールを読み込んだ時点の、空の key のままにしない）", async () => {
    expect(await allPagesHref("wiki-dev")).toBe("/w/wiki-dev/pages");
  });

  it("wiki を切り替えたら、切り替えた先の wiki の一覧へ移る", async () => {
    expect(await allPagesHref("alpha")).toBe("/w/alpha/pages");
    expect(await allPagesHref("beta")).toBe("/w/beta/pages");
  });
});
