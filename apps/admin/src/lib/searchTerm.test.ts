import { describe, expect, it } from "vitest";
import { SEARCH_DEBOUNCE_MS, searchDelay } from "./searchTerm";

describe("searchDelay", () => {
  it("waits after typing, so that each keystroke does not send a search", () => {
    expect(searchDelay("公開", false)).toBe(SEARCH_DEBOUNCE_MS);
    expect(searchDelay(" ", false)).toBe(SEARCH_DEBOUNCE_MS);
  });

  it("does not wait when the input is emptied (the first list shows at once)", () => {
    expect(searchDelay("", false)).toBe(0);
    expect(searchDelay("", true)).toBe(0);
  });

  it("holds the search while an IME is composing", () => {
    expect(searchDelay("こうかい", true)).toBeNull();
  });
});
