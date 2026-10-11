import { describe, expect, it, vi } from "vitest";
import { createSelectStore } from "./selectStore";

describe("createSelectStore", () => {
  it("replaces only the given values and tells the listeners", () => {
    const store = createSelectStore({ active: "a" as string | null, open: null as string | null });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ active: "b" });
    expect(store.get()).toEqual({ active: "b", open: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not tell the listeners when nothing changed", () => {
    const collapsed = new Set(["a"]);
    const store = createSelectStore({ active: "a", collapsed });
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ active: "a", collapsed });
    expect(listener).not.toHaveBeenCalled();
    // 中身が同じなら、入れ物の値そのものも入れ替えない（読む側が描き直さない）
    expect(store.get()).toBe(before);
  });

  it("stops telling a listener after it unsubscribes", () => {
    const store = createSelectStore({ n: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set({ n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
