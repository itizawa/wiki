import type { PageDetail, ScheduledAction } from "@wiki/shared";
import { describe, expect, it } from "vitest";
import { nextScheduled, publishState } from "./PublishMenu";

const page = (over: Partial<PageDetail>) => ({ publishedVersionId: null, visibility: "private", ...over }) as PageDetail;
const action = (id: string, runAt: string, status: ScheduledAction["status"] = "scheduled") => ({ id, runAt, status }) as ScheduledAction;

describe("公開の状態", () => {
  it("予約が無ければ、公開範囲だけ", () => {
    expect(publishState(page({}))).toEqual({ label: "非公開", color: "inherit" });
    expect(publishState(page({ publishedVersionId: "v", visibility: "public" })).label).toBe("公開中");
    expect(publishState(page({ publishedVersionId: "v", visibility: "unlisted" })).label).toBe("限定公開中");
  });

  it("非公開のページに予約があれば「予約中 日時」", () => {
    expect(publishState(page({}), action("a", "2026-10-20T01:00:00Z")).label).toBe("予約中 10/20 10:00");
  });

  it("公開中のページは、公開中のまま予約を添える", () => {
    expect(publishState(page({ publishedVersionId: "v", visibility: "public" }), action("a", "2026-10-20T01:00:00Z"))).toEqual({
      label: "公開中・予約中 10/20 10:00",
      color: "success",
    });
  });

  it("直近の予約を選び、実行済み・取り消し済みは数えない", () => {
    const actions = [action("late", "2026-11-01T00:00:00Z"), action("done", "2026-10-01T00:00:00Z", "done"), action("soon", "2026-10-20T00:00:00Z"), action("c", "2026-10-02T00:00:00Z", "canceled")];
    expect(nextScheduled(actions)?.id).toBe("soon");
    expect(nextScheduled([])).toBeNull();
  });
});
