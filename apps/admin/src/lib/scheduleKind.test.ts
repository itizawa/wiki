import { describe, expect, it } from "vitest";
import { scheduleChoices, type ScheduleState } from "./scheduleKind";

/** 公開中で、公開版が最新、変更も予約も無い */
const publishedClean: ScheduleState = { published: true, current: "public", target: "public", hasNewerVersion: false, dirty: false, actions: [] };
const draft: ScheduleState = { published: false, current: "private", target: "public", hasNewerVersion: false, dirty: false, actions: [] };

const of = (state: ScheduleState, picked: Parameters<typeof scheduleChoices>[1] = null) => {
  const { kind, choices } = scheduleChoices(state, picked);
  const [publish, unpublish] = choices;
  return { kind, publish: publish!, unpublish: unpublish! };
};

describe("予約で選べる操作", () => {
  it("いまの版をすでに公開中なら、公開の予約は選べず、非公開化の予約が既定になる", () => {
    const r = of(publishedClean);
    expect(r.publish).toEqual({ value: "publish_page", label: "公開を予約（いまの版をすでに公開中）", disabled: true });
    expect(r.unpublish).toEqual({ value: "unpublish_page", label: "非公開化を予約", disabled: false });
    expect(r.kind).toBe("unpublish_page");
  });

  it("限定公開中でも同じ", () => {
    const r = of({ ...publishedClean, current: "unlisted", target: "unlisted" });
    expect(r.publish).toMatchObject({ label: "限定公開を予約（いまの版をすでに限定公開中）", disabled: true });
    expect(r.kind).toBe("unpublish_page");
  });

  it("公開版より新しい版があれば、最新版での公開し直しを予約できる", () => {
    const r = of({ ...publishedClean, hasNewerVersion: true });
    expect(r.publish).toMatchObject({ label: "最新版での公開し直しを予約", disabled: false });
    expect(r.kind).toBe("publish_page");
  });

  it("まだ版になっていない変更があれば、いまの内容での公開し直しを予約できる（新しい版があっても、こちらの文言）", () => {
    expect(of({ ...publishedClean, dirty: true }).publish).toMatchObject({ label: "いまの内容での公開し直しを予約", disabled: false });
    expect(of({ ...publishedClean, dirty: true, hasNewerVersion: true }).publish.label).toBe("いまの内容での公開し直しを予約");
  });

  it("公開範囲を変えるなら、変更として予約できる", () => {
    expect(of({ ...publishedClean, target: "unlisted" }).publish).toMatchObject({ label: "限定公開への変更を予約", disabled: false });
    expect(of({ ...publishedClean, current: "unlisted", target: "public" }).publish).toMatchObject({ label: "公開への変更を予約", disabled: false });
    // 新しい版があっても、公開範囲の変更を先に伝える
    expect(of({ ...publishedClean, target: "unlisted", hasNewerVersion: true }).publish.label).toBe("限定公開への変更を予約");
  });

  it("先に非公開化の予約が入っていれば、そのあとの公開を予約できる", () => {
    const r = of({ ...publishedClean, actions: [{ actionType: "unpublish_page", status: "scheduled" }] });
    expect(r.publish).toMatchObject({ label: "非公開化のあとに公開を予約", disabled: false });
    expect(r.kind).toBe("publish_page");
  });

  it("実行されない予約（失敗・取り消し済み・実行済み）は数えない", () => {
    for (const status of ["failed", "canceled", "done"] as const) {
      expect(of({ ...publishedClean, actions: [{ actionType: "unpublish_page", status }] }).publish.disabled).toBe(true);
      expect(of({ ...draft, actions: [{ actionType: "publish_page", status }] }).unpublish.disabled).toBe(true);
    }
  });

  it("非公開のページは、公開の予約だけ選べる", () => {
    const r = of(draft);
    expect(r.publish).toEqual({ value: "publish_page", label: "公開を予約", disabled: false });
    expect(r.unpublish).toEqual({ value: "unpublish_page", label: "非公開化を予約（いまは非公開）", disabled: true });
    expect(r.kind).toBe("publish_page");
    expect(of({ ...draft, target: "unlisted" }).publish.label).toBe("限定公開を予約");
  });

  it("非公開でも、先に公開の予約が入っていれば、非公開化を予約できる", () => {
    const r = of({ ...draft, actions: [{ actionType: "publish_page", status: "scheduled" }] });
    expect(r.unpublish).toEqual({ value: "unpublish_page", label: "非公開化を予約", disabled: false });
    // 既定は公開の予約のまま
    expect(r.kind).toBe("publish_page");
  });

  it("選んだものが選べるあいだは、それを使う", () => {
    expect(of({ ...publishedClean, hasNewerVersion: true }, "unpublish_page").kind).toBe("unpublish_page");
    expect(of({ ...draft, actions: [{ actionType: "publish_page", status: "scheduled" }] }, "unpublish_page").kind).toBe("unpublish_page");
  });

  it("選んだものが選べなくなったら、選べるほうに切り替える", () => {
    // 公開の予約を選んだあとで、公開し直して最新版が公開版になった
    expect(of(publishedClean, "publish_page").kind).toBe("unpublish_page");
    // 非公開化の予約を選んだあとで、非公開にした
    expect(of(draft, "unpublish_page").kind).toBe("publish_page");
  });
});
