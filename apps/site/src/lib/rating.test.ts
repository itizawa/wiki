import { describe, expect, it, vi } from "vitest";
import { applyRating, fetchRating, RATER_KEY, raterId, sendRating } from "./rating";

const ID = "8f14e45f-ceea-467a-9575-3f4e2b0c8a11";
const summary = { counts: [0, 0, 0, 0, 1], total: 1, average: 5, mine: 5 };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("raterId", () => {
  it("creates an id once and remembers it", () => {
    const storage = memoryStorage();
    const newId = vi.fn(() => ID);
    expect(raterId(storage, newId)).toBe(ID);
    expect(raterId(storage, () => "other")).toBe(ID);
    expect(storage.data.get(RATER_KEY)).toBe(ID);
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it("replaces a broken saved value, and still works when storage throws or is missing", () => {
    expect(raterId(memoryStorage({ [RATER_KEY]: "nope" }), () => ID)).toBe(ID);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(raterId(throwing, () => ID)).toBe(ID);
    expect(raterId(undefined, () => ID)).toBe(ID);
  });
});

describe("fetchRating / sendRating", () => {
  it("reads the summary for this reader, and hides the section on 404 or network errors", async () => {
    const ok = vi.fn(async () => Response.json(summary));
    expect(await fetchRating(ok as unknown as typeof fetch, "abcdefghij", ID)).toEqual(summary);
    expect(ok).toHaveBeenCalledWith(`/api/ratings/abcdefghij?rater=${ID}`, expect.anything());
    expect(await fetchRating((async () => new Response("", { status: 404 })) as unknown as typeof fetch, "abcdefghij", ID)).toBeNull();
    expect(await fetchRating((async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch, "abcdefghij", ID)).toBeNull();
  });

  it("sends the score with the reader id, and explains a rate limit", async () => {
    const ok = vi.fn(async (_url: string, init?: RequestInit) => (expect(JSON.parse(String(init?.body))).toEqual({ score: 4, raterId: ID }), Response.json(summary)));
    expect(await sendRating(ok as unknown as typeof fetch, "abcdefghij", ID, 4)).toEqual({ ok: true, summary });
    const limited = await sendRating((async () => new Response("", { status: 429 })) as unknown as typeof fetch, "abcdefghij", ID, 4);
    expect(limited).toEqual({ ok: false, message: expect.stringContaining("少し待って") });
    expect((await sendRating((async () => new Response("", { status: 500 })) as unknown as typeof fetch, "abcdefghij", ID, 4)).ok).toBe(false);
  });
});

describe("applyRating", () => {
  it("adds a first rating", () => {
    expect(applyRating({ counts: [0, 0, 0, 0, 1], total: 1, average: 5, mine: null }, 3)).toEqual({
      counts: [0, 0, 1, 0, 1],
      total: 2,
      average: 4,
      mine: 3,
    });
  });

  it("moves my previous rating to the new score", () => {
    expect(applyRating({ counts: [0, 1, 0, 0, 1], total: 2, average: 3.5, mine: 2 }, 4)).toEqual({
      counts: [0, 0, 0, 1, 1],
      total: 2,
      average: 4.5,
      mine: 4,
    });
  });

  it("keeps the counts when I pick the same score again", () => {
    expect(applyRating(summary as Parameters<typeof applyRating>[0], 5)).toEqual(summary);
  });
});
