import { describe, expect, it } from "vitest";
import { edgeFadeMask, scrollEdges, wheelToSideways } from "./sideScroll";

describe("横にスクロールする書式のツールバー", () => {
  it("はみ出していなければ、どちらの端にも続きは無い（ぼかさない）", () => {
    const edges = scrollEdges({ scrollLeft: 0, scrollWidth: 412, clientWidth: 412 });
    expect(edges).toEqual({ start: false, end: false });
    expect(edgeFadeMask(edges)).toBeUndefined();
  });

  it("左端にいるときは、右の端だけぼかす", () => {
    const edges = scrollEdges({ scrollLeft: 0, scrollWidth: 412, clientWidth: 304 });
    expect(edges).toEqual({ start: false, end: true });
    expect(edgeFadeMask(edges)).toBe("linear-gradient(to right, #000 0, #000 calc(100% - 24px), transparent 100%)");
  });

  it("途中なら両端を、右端まで送ったら左の端だけをぼかす", () => {
    expect(scrollEdges({ scrollLeft: 50, scrollWidth: 412, clientWidth: 304 })).toEqual({ start: true, end: true });
    const edges = scrollEdges({ scrollLeft: 108, scrollWidth: 412, clientWidth: 304 });
    expect(edges).toEqual({ start: true, end: false });
    expect(edgeFadeMask(edges)).toBe("linear-gradient(to right, transparent 0, #000 24px, #000 100%)");
  });

  it("ホイールの縦の回転は、はみ出しているときだけ横に回す", () => {
    expect(wheelToSideways({ scrollWidth: 412, clientWidth: 304 }, { deltaX: 0, deltaY: 40 })).toBe(40);
    // はみ出していなければ、ページのスクロールに任せる
    expect(wheelToSideways({ scrollWidth: 412, clientWidth: 412 }, { deltaX: 0, deltaY: 40 })).toBeNull();
    // トラックパッドの横送りは、そのまま（ブラウザに任せる）
    expect(wheelToSideways({ scrollWidth: 412, clientWidth: 304 }, { deltaX: 30, deltaY: 5 })).toBeNull();
  });
});
