import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { setApiWiki } from "./api";
import { newPageCallbacks, newPageRequest } from "./createPage";
import { takeJustCreated } from "./newPage";
import { UNTITLED_TITLE } from "./untitled";

describe("newPageRequest", () => {
  it("タイトルが無い・空なら「無題」にする（サイドバー・すべてのページ・何も打っていないコマンドメニュー）", () => {
    expect(newPageRequest({ parentPageId: null })).toEqual({ title: UNTITLED_TITLE, parentPageId: null });
    expect(newPageRequest({ title: "" })).toEqual({ title: UNTITLED_TITLE, parentPageId: undefined });
  });
  it("打ったタイトルと親ページは、そのまま渡す", () => {
    expect(newPageRequest({ title: "議事録", parentPageId: "p1" })).toEqual({ title: "議事録", parentPageId: "p1" });
  });
});

describe("newPageCallbacks", () => {
  it("作ったら印を付け、onCreated を呼んでから、そのページのエディタへ移る", async () => {
    setApiWiki("wiki");
    const calls: string[] = [];
    const navigate = vi.fn(async (to: unknown) => {
      calls.push("navigate");
      return to;
    });
    const cb = newPageCallbacks(new QueryClient(), navigate, () => calls.push("onCreated"));
    await cb.onSuccess({ id: "new-page" });
    expect(calls).toEqual(["onCreated", "navigate"]);
    expect(navigate).toHaveBeenCalledWith({ to: "/w/$wikiKey/pages/$pageId", params: { wikiKey: "wiki", pageId: "new-page" } });
    expect(takeJustCreated("new-page")).toBe(true);
  });

  it("作り終えたら（失敗しても）ツリー・一覧・検索を取り直す", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    newPageCallbacks(qc, vi.fn()).onSettled();
    expect(spy.mock.calls).toEqual([[{ queryKey: ["structure"] }], [{ queryKey: ["pages"] }], [{ queryKey: ["search"] }]]);
  });
});
