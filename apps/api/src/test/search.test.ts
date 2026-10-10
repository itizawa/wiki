import { afterEach, describe, expect, it } from "vitest";
import { setup, W } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

async function newPage(title: string, bodyMd = ""): Promise<string> {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return res.body.id;
}

const search = async (q: string) => {
  const res = await ctx.call("GET", `${W}/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return res.body.results as { id: string; title: string; snippet: string | null }[];
};
const titles = async (q: string) => (await search(q)).map((r) => r.title).sort();

describe("search", () => {
  it("finds pages by title or body, and shows where the body matched", async () => {
    ctx = await setup();
    await newPage("公開の手順", "まず下書きを書きます。");
    await newPage("メモ", "## 予約\n\n**公開**は予約の実行で行われます。");
    await newPage("関係ないページ", "なにもない");

    const results = await search("公開");
    // タイトルに一致したものを先に出す
    expect(results.map((r) => r.title)).toEqual(["公開の手順", "メモ"]);
    expect(results[0]!.snippet).toBeNull();
    expect(results[1]!.snippet).toBe("予約 公開は予約の実行で行われます。");
  });

  it("supports AND, quoted phrases, exclusion and OR", async () => {
    ctx = await setup();
    await newPage("A", "red apple pie");
    await newPage("B", "red pie apple");
    await newPage("C", "green apple");

    expect(await titles("red apple")).toEqual(["A", "B"]);
    expect(await titles('"red apple"')).toEqual(["A"]);
    expect(await titles("apple -red")).toEqual(["C"]);
    expect(await titles("green OR pie")).toEqual(["A", "B", "C"]);
    expect(await titles('"pie apple" OR green')).toEqual(["B", "C"]);
    // 大文字と小文字は区別しない
    expect(await titles("RED APPLE")).toEqual(["A", "B"]);
  });

  it("treats % and _ as plain characters", async () => {
    ctx = await setup();
    await newPage("100% 完了");
    await newPage("1000 完了");
    expect(await titles("100%")).toEqual(["100% 完了"]);
    expect(await titles("_")).toEqual([]);
  });

  it("searches the current body only, and skips deleted pages", async () => {
    ctx = await setup();
    const id = await newPage("書き直し", "古い言葉");
    const page = (await ctx.call("GET", `${W}/pages/${id}`)).body;
    await ctx.call("PUT", `${W}/pages/${id}`, { baseVersionId: page.headVersionId, title: "書き直し", bodyMd: "新しい言葉" });
    expect(await titles("古い言葉")).toEqual([]);
    expect(await titles("新しい言葉")).toEqual(["書き直し"]);

    await ctx.call("DELETE", `${W}/pages/${id}`);
    expect(await titles("新しい言葉")).toEqual([]);
  });

  it("returns recent pages when the query is empty", async () => {
    ctx = await setup();
    await newPage("one");
    await newPage("two");
    const results = await search("  ");
    expect(results.map((r) => r.title)).toEqual(["two", "one"]);
    expect(results.every((r) => r.snippet === null)).toBe(true);
  });

  it("searches the open wiki only", async () => {
    ctx = await setup();
    await newPage("こちらの手順", "共通の言葉");
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "開発ノート" })).status).toBe(201);
    expect((await ctx.call("POST", "/admin/w/notes/pages", { title: "ノートの手順", bodyMd: "共通の言葉" })).status).toBe(201);

    expect(await titles("共通の言葉")).toEqual(["こちらの手順"]);
    expect((await search("")).map((r) => r.title)).toEqual(["こちらの手順"]);
    const notes = await ctx.call("GET", `/admin/w/notes/search?q=${encodeURIComponent("共通の言葉")}`);
    expect(notes.body.results.map((r: { title: string }) => r.title)).toEqual(["ノートの手順"]);
  });

  it("requires a session", async () => {
    ctx = await setup();
    expect((await ctx.app.request(`${W}/search?q=x`)).status).toBe(401);
  });
});
