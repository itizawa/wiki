import type { ScheduledAction } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { entryLink, type Entry } from "./CalendarPage";
import { pageLink } from "../lib/wiki";

const action = (pageId: string | null): Entry => ({
  kind: "action",
  at: "2026-10-15T03:00:00.000Z",
  action: { id: "a1", actionType: pageId ? "publish_page" : "merge_branch", pageId, branchName: pageId ? null : "draft/x", status: "scheduled" } as ScheduledAction,
});

describe("編集カレンダーの行の遷移先", () => {
  it("ページがある予約・公開済み・AI下書きは、そのページへ移る", () => {
    expect(entryLink(action("p1"))).toEqual(pageLink("p1"));
    expect(entryLink({ kind: "published", at: "", pageId: "p2", title: "t", unlisted: false })).toEqual(pageLink("p2"));
    expect(entryLink({ kind: "draft", at: "", pageId: "p3", title: "t" })).toEqual(pageLink("p3"));
  });

  it("ページが無い予約（ブランチの反映）は、押せる行にしない", () => {
    expect(entryLink(action(null))).toBeUndefined();
  });
});
