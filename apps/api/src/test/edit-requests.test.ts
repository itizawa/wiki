import { IMAGE_NAME_PATTERN, type CreateEditRequestInput, type PageEditRequests } from "@wiki/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createEditRequest } from "../editRequests/service";
import { cleanupImages, referencedImageNames } from "../images/cleanup";
import { memoryImageStore } from "../images/store";
import { pruneVersions } from "../pages/prune";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const BODY = ["# 見出し", "", "1段落目", "", "- a", "- b", "- c", "", "最後の段落"].join("\n");

async function newPage(bodyMd = BODY, title = "ページ") {
  const res = await ctx.call("POST", `${W}/pages`, { title, bodyMd });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, head: res.body.headVersionId as string };
}

type ItemInput = CreateEditRequestInput["items"][number];

/** 編集リクエストを出す（出す API はまだ無いので、MCP の道具と同じ関数を直接呼ぶ） */
async function request(page: { id: string; head: string }, items: ItemInput[], opts: { userId?: string; comment?: string; base?: string } = {}) {
  const [wiki] = (await ctx.client.query<{ id: string }>(`select wiki_id as id from pages where id = $1`, [page.id])).rows;
  return ctx.db.transaction((tx) =>
    createEditRequest(tx, {
      wikiId: wiki!.id,
      pageId: page.id,
      input: { baseVersionId: opts.base ?? page.head, comment: opts.comment, items },
      actor: { userId: opts.userId ?? ctx.owner.id },
    }),
  );
}

const getPage = async (id: string) => (await ctx.call("GET", `${W}/pages/${id}`)).body;
const list = async (id: string) => (await ctx.call<PageEditRequests>("GET", `${W}/pages/${id}/edit-requests`)).body;
const itemsOf = async (id: string) => (await list(id)).requests.flatMap((r) => r.items);
const accept = (pageId: string, itemId: string, call = ctx.call) => call("POST", `${W}/pages/${pageId}/edit-request-items/${itemId}/accept`);
const save = (page: { id: string; head: string }, bodyMd: string, call = ctx.call) =>
  call("PUT", `${W}/pages/${page.id}`, { baseVersionId: page.head, title: "ページ", bodyMd });

describe("making an edit request", () => {
  it("cuts the original text out of the base version, and keeps the items in order", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(
      page,
      [
        { startLine: 5, endLine: 7, replacement: "- まとめた", reason: "3つは多い" },
        { startLine: 3, endLine: 3, replacement: "" },
      ],
      { comment: "読みやすくする案" },
    );
    const body = await list(page.id);
    expect(body.headVersionId).toBe(page.head);
    expect(body.headBodyMd).toBe(BODY);
    expect(body.openCount).toBe(2);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ id: made.id, comment: "読みやすくする案", createdBy: { id: ctx.owner.id, name: "オーナー" }, via: null });
    expect(body.requests[0]!.items.map((i) => i.id)).toEqual(made.itemIds);
    expect(body.requests[0]!.items[0]).toMatchObject({
      kind: "suggestion",
      status: "open",
      baseVersionId: page.head,
      startLine: 5,
      endLine: 7,
      originalText: "- a\n- b\n- c",
      replacement: "- まとめた",
      reason: "3つは多い",
      current: { startLine: 5, endLine: 7 },
      stale: null,
      decidedBy: null,
      acceptedVersionId: null,
    });
    expect(body.requests[0]!.items[1]).toMatchObject({ originalText: "1段落目", replacement: "", reason: null });
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests/count`)).body).toEqual({ open: 2 });
  });

  it("refuses a base version that is not the latest, lines outside the body, and a replacement that changes nothing", async () => {
    ctx = await setup();
    const page = await newPage();
    const item = { startLine: 3, endLine: 3, replacement: "x" };
    await expect(request(page, [{ ...item, endLine: 10 }])).rejects.toMatchObject({ status: 400, code: "line_out_of_range", details: { index: 0, lineCount: 9 } });
    await expect(request(page, [item, { startLine: 9, endLine: 9, replacement: "最後の段落" }])).rejects.toMatchObject({ status: 400, code: "no_change", details: { index: 1 } });
    // 空行を消す提案は、変更として受け付ける
    await expect(request(page, [{ startLine: 2, endLine: 2, replacement: "" }])).resolves.toBeTruthy();

    const saved = await save(page, `${BODY}\n\n足した`);
    expect(saved.status).toBe(200);
    await expect(request(page, [item])).rejects.toMatchObject({ status: 409, code: "version_conflict", details: { headVersionId: saved.body.headVersionId } });
    // 断ったものは、何も残さない
    expect((await list(page.id)).requests).toHaveLength(1);
  });
});

describe("accepting an item", () => {
  it("replaces the lines in a new version, moves the head, and does not publish", async () => {
    ctx = await setup();
    const page = await newPage();
    expect((await ctx.call("POST", `${W}/pages/${page.id}/publish`, { versionId: page.head, visibility: "public" })).status).toBe(200);
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [{ startLine: 5, endLine: 7, replacement: "- まとめた\n- もう1つ" }]);

    const res = await accept(page.id, made.itemIds[0]!, editor.call);
    expect(res.status).toBe(200);
    const after = await getPage(page.id);
    expect(res.body).toEqual({
      headVersionId: after.headVersionId,
      versionId: after.headVersionId,
      applied: [{ itemId: made.itemIds[0], startLine: 5, endLine: 6 }],
      skipped: [],
    });
    expect(after.headVersionId).not.toBe(page.head);
    expect(after.head.bodyMd).toBe(BODY.replace("- a\n- b\n- c", "- まとめた\n- もう1つ"));
    // 版は、採用した人が作った「残す版」。もとの項目をたどれる
    expect(after.head).toMatchObject({ baseVersionId: page.head, title: "ページ", keep: true, acceptedItems: 1, createdBy: { id: editor.user.id } });
    const versions = (await ctx.call("GET", `${W}/pages/${page.id}/versions?limit=10`)).body.versions;
    expect(versions.map((v: any) => [v.id, v.acceptedItems])).toEqual([
      [after.headVersionId, 1],
      [page.head, 0],
    ]);
    // 公開はしない：公開側は、公開し直すまで前の版のまま
    expect(after.publishedVersionId).toBe(page.head);
    expect((await wikiManifest(ctx.db)).pages.find((p) => p.id === page.id)?.bodyMd).toBe(BODY);
    // 検索用の写しも、新しい本文になる
    expect((await ctx.call("GET", `${W}/search?q=${encodeURIComponent("まとめた")}`)).body.results.map((r: any) => r.id)).toEqual([page.id]);

    const [item] = await itemsOf(page.id);
    expect(item).toMatchObject({ status: "accepted", acceptedVersionId: after.headVersionId, decidedBy: { id: editor.user.id }, current: null, stale: null });
    expect(item!.decidedAt).not.toBeNull();
    expect((await list(page.id)).openCount).toBe(0);
    // 2回目は、もう未対応ではない
    const again = await accept(page.id, made.itemIds[0]!);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "not_open", details: { status: "accepted" } });
    expect((await getPage(page.id)).headVersionId).toBe(after.headVersionId);
  });

  it("finds the original text again when the body has moved on, and applies it there", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [{ startLine: 9, endLine: 9, replacement: "最後の段落（直した）" }]);
    const moved = `冒頭に足した段落\n\n${BODY}`;
    const saved = await save(page, moved);
    expect((await itemsOf(page.id))[0]).toMatchObject({ startLine: 9, endLine: 9, current: { startLine: 11, endLine: 11 }, stale: null });

    const res = await accept(page.id, made.itemIds[0]!);
    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual([{ itemId: made.itemIds[0], startLine: 11, endLine: 11 }]);
    const after = await getPage(page.id);
    expect(after.head.bodyMd).toBe(moved.replace("最後の段落", "最後の段落（直した）"));
    expect(after.head.baseVersionId).toBe(saved.body.headVersionId);
  });

  it("answers 409 for an item whose original text is gone or no longer unique, and leaves the page alone", async () => {
    ctx = await setup();
    const page = await newPage("同じ行\n\n別の行\n\n同じ行");
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "別の行（直した）" },
      { startLine: 5, endLine: 5, replacement: "同じ行（直した）" },
    ]);
    const saved = await save(page, "足した行\n同じ行\n\n書き換えた行\n\n同じ行");
    expect((await itemsOf(page.id)).map((i) => [i.stale, i.current])).toEqual([
      ["not_found", null],
      ["ambiguous", null],
    ]);
    for (const [i, reason] of [
      [0, "not_found"],
      [1, "ambiguous"],
    ] as const) {
      const res = await accept(page.id, made.itemIds[i]!);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "edit_request_stale", details: { reason } });
    }
    expect((await getPage(page.id)).headVersionId).toBe(saved.body.headVersionId);
    // 古くなった項目は、未対応のまま残る（自動では閉じない）。却下はできる
    expect((await list(page.id)).openCount).toBe(2);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[0]}/reject`)).status).toBe(200);
  });

  it("makes the other suggestion for the same line stale once one is accepted", async () => {
    ctx = await setup();
    const page = await newPage();
    const a = await request(page, [{ startLine: 3, endLine: 3, replacement: "案A" }]);
    const b = await request(page, [{ startLine: 3, endLine: 3, replacement: "案B" }]);
    expect((await accept(page.id, a.itemIds[0]!)).status).toBe(200);
    const other = (await itemsOf(page.id)).find((i) => i.id === b.itemIds[0]);
    expect(other).toMatchObject({ status: "open", stale: "not_found", current: null });
    expect((await accept(page.id, b.itemIds[0]!)).status).toBe(409);
  });

  it("treats a page of another wiki, a page in the trash and an archived wiki as not found", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    const other = (await ctx.call("POST", "/admin/w/notes/pages", { title: "別の wiki", bodyMd: BODY })).body;

    // 別の wiki の経路からは、ページも項目も見えない
    for (const [method, path] of [
      ["GET", `/admin/w/notes/pages/${page.id}/edit-requests`],
      ["GET", `/admin/w/notes/pages/${page.id}/edit-requests/count`],
      ["GET", `/admin/w/notes/pages/${page.id}/edit-requests/applied?since=${page.head}`],
      ["POST", `/admin/w/notes/pages/${page.id}/edit-request-items/${made.itemIds[0]}/accept`],
      ["POST", `/admin/w/notes/pages/${page.id}/edit-request-items/${made.itemIds[0]}/reject`],
      ["POST", `/admin/w/notes/pages/${page.id}/edit-requests/${made.id}/accept-all`],
      ["POST", `/admin/w/notes/pages/${page.id}/edit-requests/${made.id}/withdraw`],
      // 別のページの項目を、自分の wiki のページの経路で指しても採用できない
      ["POST", `/admin/w/notes/pages/${other.id}/edit-request-items/${made.itemIds[0]}/accept`],
      ["POST", `/admin/w/notes/pages/${other.id}/edit-requests/${made.id}/accept-all`],
      ["POST", `/admin/w/notes/pages/${other.id}/edit-requests/${made.id}/withdraw`],
      ["POST", `${W}/pages/${page.id}/edit-request-items/not-a-uuid/accept`],
    ] as const) {
      expect((await ctx.call(method, path)).status, `${method} ${path}`).toBe(404);
    }
    // その wiki のメンバーでない人には、wiki ごと見えない
    const outsider = await ctx.addUser("outsider@example.com", { notes: "editor" });
    expect((await outsider.call("GET", `${W}/pages/${page.id}/edit-requests`)).status).toBe(404);
    expect((await accept(page.id, made.itemIds[0]!, outsider.call)).status).toBe(404);
    expect((await getPage(page.id)).headVersionId).toBe(page.head);

    // ゴミ箱のページ
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests`)).status).toBe(404);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/restore`)).status).toBe(200);
    // アーカイブ中の wiki
    const inNotes = await request({ id: other.id, head: other.headVersionId }, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    expect((await ctx.call("POST", `/admin/w/notes/pages/${other.id}/edit-request-items/${inNotes.itemIds[0]}/accept`)).status).toBe(404);
    // 元に戻したページでは、また採用できる
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(200);
  });
});

describe("drafts of people who are editing", () => {
  it("applies the same replacement to drafts based on the head, and moves them onto the new version", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    // 編集中の人：ほかの箇所を書き足している
    const editing = BODY.replace("1段落目", "1段落目に書き足し中").replace("# 見出し", "# 見出し\n\n足した段落");
    const draft = await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "書きかけの題", bodyMd: editing });
    expect(draft.status).toBe(200);
    const made = await request(page, [{ startLine: 9, endLine: 9, replacement: "最後の段落（直した）" }]);
    const res = await accept(page.id, made.itemIds[0]!);
    expect(res.status).toBe(200);

    const after = (await editor.call("GET", `${W}/pages/${page.id}/draft`)).body.draft;
    expect(after).toMatchObject({
      baseVersionId: res.body.versionId,
      title: "書きかけの題",
      bodyMd: editing.replace("最後の段落", "最後の段落（直した）"),
      // 本人が打ったわけではないので、自動保存の時刻は進めない
      updatedAt: draft.body.draft.updatedAt,
    });
    // 編集中の人は、付け替わった版をもとに、そのまま下書きを保存できる（採用を巻き戻さない）
    const next = await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: res.body.versionId, title: "書きかけの題", bodyMd: `${after.bodyMd}\n続き` });
    expect(next.status).toBe(200);
    // 開いたままの画面が古い版のまま保存しようとすると、今までどおり 409
    const stale = await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "書きかけの題", bodyMd: editing });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_conflict");
  });

  it("stops with 409 and the editor's name when a draft no longer has the original text", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const editing = BODY.replace("最後の段落", "最後の段落を書き換え中");
    expect((await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "ページ", bodyMd: editing })).status).toBe(200);
    const made = await request(page, [
      { startLine: 9, endLine: 9, replacement: "最後の段落（直した）" },
      { startLine: 3, endLine: 3, replacement: "1段落目（直した）" },
    ]);

    const res = await accept(page.id, made.itemIds[0]!);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "draft_conflict", details: { editors: [{ id: editor.user.id, name: "editor" }] } });
    expect((await getPage(page.id)).headVersionId).toBe(page.head);
    expect((await editor.call("GET", `${W}/pages/${page.id}/draft`)).body.draft).toMatchObject({ baseVersionId: page.head, bodyMd: editing });
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "open", stale: null });

    // 下書きに元の文面が残っている項目は、採用できる
    expect((await accept(page.id, made.itemIds[1]!)).status).toBe(200);
    expect((await editor.call("GET", `${W}/pages/${page.id}/draft`)).body.draft.bodyMd).toBe(editing.replace("1段落目", "1段落目（直した）"));
    // 編集中の人が下書きを破棄すれば、止まっていた項目も採用できる
    expect((await editor.call("DELETE", `${W}/pages/${page.id}/draft`)).status).toBe(200);
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(200);
  });

  it("leaves a draft based on an older version alone", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    expect((await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "ページ", bodyMd: "古い版をもとにした下書き" })).status).toBe(200);
    const saved = await save(page, `${BODY}\n\n足した`);
    const made = await request({ id: page.id, head: saved.body.headVersionId }, [{ startLine: 3, endLine: 3, replacement: "1段落目（直した）" }]);
    // 元の文面は下書きに無いが、古い版をもとにした下書きは、もともと版にならないので採用を止めない
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(200);
    expect((await editor.call("GET", `${W}/pages/${page.id}/draft`)).body.draft).toMatchObject({ baseVersionId: page.head, bodyMd: "古い版をもとにした下書き" });
  });

  it("tells the open editor what was applied since its version, unless someone saved in between", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const applied = (since: string, call = editor.call) => call("GET", `${W}/pages/${page.id}/edit-requests/applied?since=${since}`);
    expect((await applied(page.head)).body).toEqual({ headVersionId: page.head, mergeable: true, steps: [] });

    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "1段落目（直した）" },
      { startLine: 9, endLine: 9, replacement: "" },
      { startLine: 1, endLine: 1, replacement: "# 新しい見出し" },
    ]);
    const first = await accept(page.id, made.itemIds[2]!);
    const all = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/accept-all`);
    expect(all.status).toBe(200);
    expect((await applied(page.head)).body).toEqual({
      headVersionId: all.body.versionId,
      mergeable: true,
      steps: [
        { versionId: first.body.versionId, acceptedBy: { id: ctx.owner.id, name: "オーナー" }, edits: [{ itemId: made.itemIds[2], originalText: "# 見出し", replacement: "# 新しい見出し" }] },
        {
          versionId: all.body.versionId,
          acceptedBy: { id: ctx.owner.id, name: "オーナー" },
          edits: [
            { itemId: made.itemIds[0], originalText: "1段落目", replacement: "1段落目（直した）" },
            { itemId: made.itemIds[1], originalText: "最後の段落", replacement: "" },
          ],
        },
      ],
    });
    expect((await applied(first.body.versionId)).body.steps).toHaveLength(1);

    // だれかがふつうに保存した版が挟まると、取り込めない
    const saved = await save({ id: page.id, head: all.body.versionId }, "別の人が書き直した");
    expect((await applied(page.head)).body).toEqual({ headVersionId: saved.body.headVersionId, mergeable: false, steps: [] });
    // 知らない版・形の違う版
    expect((await applied("00000000-0000-4000-8000-000000000000")).body.mergeable).toBe(false);
    expect((await applied("nope")).status).toBe(404);
  });

  it("lets the editor through its own automatic version when looking for what was applied", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    // 編集中の人の下書きから、ワーカーが自動で版を作った（開いたままの画面は、まだ知らない）
    const auto = (
      await ctx.client.query<{ id: string }>(
        `insert into page_versions (page_id, base_version_id, title, body_md, author_type, keep, created_by)
         values ($1, $2, 'ページ', $3, 'human', false, $4) returning id`,
        [page.id, page.head, `${BODY}\n\n自動で版になった続き`, editor.user.id],
      )
    ).rows[0]!.id;
    await ctx.client.query(`update pages set head_version_id = $1 where id = $2`, [auto, page.id]);
    const made = await request({ id: page.id, head: auto }, [{ startLine: 3, endLine: 3, replacement: "1段落目（直した）" }]);
    const res = await accept(page.id, made.itemIds[0]!);
    const path = `${W}/pages/${page.id}/edit-requests/applied?since=${page.head}`;
    expect((await editor.call("GET", path)).body).toMatchObject({ mergeable: true, steps: [{ versionId: res.body.versionId }] });
    // ほかの人にとっては、知らない版が挟まっている
    expect((await ctx.call("GET", path)).body.mergeable).toBe(false);
  });
});

describe("accepting everything in a request", () => {
  it("puts the items that can be applied into one version and reports the rest", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [
      { startLine: 1, endLine: 1, replacement: "# 見出し\n\n足した説明" },
      { startLine: 5, endLine: 6, replacement: "- ab" },
      // 上の項目と行が重なる
      { startLine: 6, endLine: 7, replacement: "- bc" },
      { startLine: 9, endLine: 9, replacement: "最後の段落（直した）" },
      { startLine: 3, endLine: 3, replacement: "" },
    ]);
    const other = await request(page, [{ startLine: 2, endLine: 2, replacement: "" }]);
    // 編集中の人が、最後の段落を書き換えている
    const editing = BODY.replace("最後の段落", "最後の段落を書き換え中");
    expect((await editor.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "ページ", bodyMd: editing })).status).toBe(200);
    // 却下した項目は、対象にしない
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[4]}/reject`)).status).toBe(200);

    const res = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/accept-all`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toEqual([
      { itemId: made.itemIds[0], startLine: 1, endLine: 3 },
      { itemId: made.itemIds[1], startLine: 7, endLine: 7 },
    ]);
    expect(res.body.skipped).toEqual([
      { itemId: made.itemIds[2], reason: "overlap" },
      { itemId: made.itemIds[3], reason: "draft_conflict", editors: [{ id: editor.user.id, name: "editor" }] },
    ]);
    const after = await getPage(page.id);
    expect(after.headVersionId).toBe(res.body.versionId);
    expect(after.head.bodyMd).toBe(["# 見出し", "", "足した説明", "", "1段落目", "", "- ab", "- c", "", "最後の段落"].join("\n"));
    // 版は1つだけ増える
    expect(after.head).toMatchObject({ baseVersionId: page.head, acceptedItems: 2 });
    expect((await editor.call("GET", `${W}/pages/${page.id}/draft`)).body.draft).toMatchObject({
      baseVersionId: res.body.versionId,
      bodyMd: ["# 見出し", "", "足した説明", "", "1段落目", "", "- ab", "- c", "", "最後の段落を書き換え中"].join("\n"),
    });
    expect((await itemsOf(page.id)).map((i) => [i.id, i.status])).toEqual([
      [other.itemIds[0], "open"],
      [made.itemIds[0], "accepted"],
      [made.itemIds[1], "accepted"],
      [made.itemIds[2], "open"],
      [made.itemIds[3], "open"],
      [made.itemIds[4], "rejected"],
    ]);

    // 採用できる項目が1つも無ければ、版を作らない
    const again = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/accept-all`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ headVersionId: res.body.versionId, versionId: null, applied: [] });
    expect(again.body.skipped.map((s: any) => s.reason)).toEqual(["not_found", "draft_conflict"]);
    expect((await getPage(page.id)).headVersionId).toBe(res.body.versionId);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/00000000-0000-4000-8000-000000000000/accept-all`)).status).toBe(404);
  });
});

describe("rejecting, reopening and withdrawing", () => {
  it("rejects an open item and puts a rejected one back to open", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    const path = (action: string) => `${W}/pages/${page.id}/edit-request-items/${made.itemIds[0]}/${action}`;

    const reopenOpen = await ctx.call("POST", path("reopen"));
    expect(reopenOpen.status).toBe(409);
    expect(reopenOpen.body.error.code).toBe("not_rejected");
    expect((await editor.call("POST", path("reject"))).status).toBe(200);
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "rejected", decidedBy: { id: editor.user.id, name: "editor" }, current: { startLine: 3, endLine: 3 }, stale: null });
    expect((await list(page.id)).openCount).toBe(0);
    expect((await ctx.call("POST", path("reject"))).status).toBe(409);
    expect((await ctx.call("POST", path("accept"))).status).toBe(409);
    expect((await getPage(page.id)).headVersionId).toBe(page.head);

    expect((await ctx.call("POST", path("reopen"))).status).toBe(200);
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "open", decidedBy: null, decidedAt: null });
    expect((await ctx.call("POST", path("accept"))).status).toBe(200);
    // 採用した項目は、未対応に戻せない（取り消しは、版履歴から前の版に戻す）
    expect((await ctx.call("POST", path("reopen"))).status).toBe(409);
  });

  it("lets only the requester withdraw, and withdraws only the open items", async () => {
    ctx = await setup();
    const page = await newPage();
    const requester = await ctx.addUser("requester@example.com", { wiki: "editor" });
    const made = await request(
      page,
      [
        { startLine: 3, endLine: 3, replacement: "x" },
        { startLine: 5, endLine: 5, replacement: "- A" },
        { startLine: 9, endLine: 9, replacement: "y" },
      ],
      { userId: requester.user.id },
    );
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(200);
    const path = `${W}/pages/${page.id}/edit-requests/${made.id}/withdraw`;

    // 出した本人でなければ、オーナーでも取り下げられない
    const notMine = await ctx.call("POST", path);
    expect(notMine.status).toBe(403);
    expect(notMine.body.error.code).toBe("not_requester");
    expect((await list(page.id)).openCount).toBe(2);

    const res = await requester.call("POST", path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ withdrawn: 2 });
    expect((await itemsOf(page.id)).map((i) => i.status)).toEqual(["accepted", "withdrawn", "withdrawn"]);
    // 取り下げた項目は、採用も、未対応に戻すこともできない
    expect((await accept(page.id, made.itemIds[1]!)).status).toBe(409);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[1]}/reopen`)).status).toBe(409);
    expect((await requester.call("POST", path)).body).toEqual({ withdrawn: 0 });
  });
});

describe("requests arriving at the same time", () => {
  it("applies both when two people accept different items at once", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [
      { startLine: 1, endLine: 1, replacement: "# 見出し\n\n足した説明" },
      { startLine: 9, endLine: 9, replacement: "最後の段落（直した）" },
    ]);
    const [a, b] = await Promise.all([accept(page.id, made.itemIds[0]!), accept(page.id, made.itemIds[1]!, editor.call)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = await getPage(page.id);
    // あとから来たほうは、先にできた版の上に、場所を探し直してかかる
    expect(after.head.bodyMd).toBe(["# 見出し", "", "足した説明", "", "1段落目", "", "- a", "- b", "- c", "", "最後の段落（直した）"].join("\n"));
    expect((await ctx.call("GET", `${W}/pages/${page.id}/versions?limit=10`)).body.versions).toHaveLength(3);
    expect([a.body.versionId, b.body.versionId]).toContain(after.headVersionId);
    expect(a.body.versionId).not.toBe(b.body.versionId);
  });

  it("accepts once when two people accept the same item at once", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [{ startLine: 5, endLine: 5, replacement: "- a\n- a2" }]);
    const results = await Promise.all([accept(page.id, made.itemIds[0]!), accept(page.id, made.itemIds[0]!, editor.call)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("not_open");
    // 2回かかっていない
    expect((await getPage(page.id)).head.bodyMd).toBe(BODY.replace("- a", "- a\n- a2"));
    expect((await ctx.call("GET", `${W}/pages/${page.id}/versions?limit=10`)).body.versions).toHaveLength(2);
  });

  it("keeps the body whole when an accept and a save arrive at once", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [
      { startLine: 9, endLine: 9, replacement: "最後の段落（直した）" },
      { startLine: 3, endLine: 3, replacement: "1段落目（直した）" },
    ]);
    const mine = BODY.replace("# 見出し", "# 書き換えた見出し");
    const withAccept = (body: string) => body.replace("最後の段落", "最後の段落（直した）");

    // 保存が触っていない箇所の採用：どちらが先でも、採用は入る。保存が後なら、知らない版の上には書かない（409）
    const [accepted, saved] = await Promise.all([accept(page.id, made.itemIds[0]!), save(page, mine, editor.call)]);
    expect(accepted.status).toBe(200);
    expect([200, 409]).toContain(saved.status);
    const first = await getPage(page.id);
    expect(first.head.bodyMd).toBe(saved.status === 200 ? withAccept(mine) : withAccept(BODY));
    if (saved.status === 409) expect(saved.body.error.code).toBe("version_conflict");

    // 保存が書き換えた箇所の採用：通るのは片方だけ。保存が先なら採用は「古くなった」（409）、採用が先なら保存が 409
    const rewritten = first.head.bodyMd.replace("1段落目", "1段落目を書き換えた");
    const [saved2, accepted2] = await Promise.all([
      save({ id: page.id, head: first.headVersionId }, rewritten, editor.call),
      accept(page.id, made.itemIds[1]!),
    ]);
    expect([saved2.status, accepted2.status].sort()).toEqual([200, 409]);
    const second = await getPage(page.id);
    if (saved2.status === 200) {
      expect(accepted2.body.error).toMatchObject({ code: "edit_request_stale", details: { reason: "not_found" } });
      expect(second.head.bodyMd).toBe(rewritten);
    } else {
      expect(saved2.body.error.code).toBe("version_conflict");
      expect(second.head.bodyMd).toBe(first.head.bodyMd.replace("1段落目", "1段落目（直した）"));
    }
  });
});

describe("what keeps working around edit requests", () => {
  it("does not prune a version that an item is based on", async () => {
    ctx = await setup();
    const page = await newPage();
    const now = new Date("2026-06-20T03:00:00.000Z");
    const addAuto = async (createdAt: string, base: string | null) =>
      (
        await ctx.client.query<{ id: string }>(
          `insert into page_versions (page_id, base_version_id, title, body_md, author_type, keep, created_at)
           values ($1, $2, 'ページ', $3, 'human', false, $4::timestamptz) returning id`,
          [page.id, base, BODY, createdAt],
        )
      ).rows[0]!.id;
    // 同じ日に自動の版が3つ：いちばん新しい1つを残して間引かれるはずのもの
    const based = await addAuto("2026-06-18T01:00:00Z", page.head);
    const plain = await addAuto("2026-06-18T03:00:00Z", based);
    const newest = await addAuto("2026-06-18T09:00:00Z", plain);
    // 項目が、間引かれるはずの版を基準にしている（出したあとに版が進んだ）
    await ctx.client.query(`update pages set head_version_id = $1 where id = $2`, [based, page.id]);
    const made = await request({ id: page.id, head: based }, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    await ctx.client.query(`update pages set head_version_id = $1 where id = $2`, [newest, page.id]);

    expect(await pruneVersions(ctx.db, now)).toEqual({ deleted: 1 });
    const left = new Set((await ctx.client.query<{ id: string }>(`select id from page_versions where page_id = $1`, [page.id])).rows.map((r) => r.id));
    expect([left.has(based), left.has(plain), left.has(newest)]).toEqual([true, false, true]);
    // 却下しても、項目が残っているあいだは消さない
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[0]}/reject`)).status).toBe(200);
    expect(await pruneVersions(ctx.db, now)).toEqual({ deleted: 0 });
    // 基準の版が残っているので、読める
    expect((await itemsOf(page.id))[0]).toMatchObject({ baseVersionId: based, status: "rejected", current: { startLine: 3, endLine: 3 } });
  });

  it("keeps an image that only an edit request item uses", async () => {
    const images = memoryImageStore();
    ctx = await setup({ images });
    const old = new Date(Date.now() - 60 * 24 * 60 * 60_000);
    const image = (id: string) => {
      const name = `${id.repeat(24)}.png`;
      expect(name).toMatch(new RegExp(`^${IMAGE_NAME_PATTERN}$`));
      images.files.set(name, { body: new Uint8Array([1]), contentType: "image/png", uploaded: old });
      return name;
    };
    const names = { original: image("a"), open: image("b"), rejected: image("c"), withdrawn: image("d") };
    const orphan = image("e");
    const page = await newPage(`前\n\n![図](/images/${names.original})\n\n後`);
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: `![新しい図](/images/${names.open})` },
      { startLine: 1, endLine: 1, replacement: `前 ![却下](/images/${names.rejected})` },
    ]);
    const second = await request(page, [{ startLine: 5, endLine: 5, replacement: `後 <img src="/images/${names.withdrawn}">` }]);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[1]}/reject`)).status).toBe(200);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${second.id}/withdraw`)).body).toEqual({ withdrawn: 1 });
    // 項目の「元の文面」の列も読んでいることを確かめるため、版の本文からは画像を外しておく
    // （ふだんは、基準の版が間引かれずに残るので、元の文面の画像は版の本文からも参照されている）
    await ctx.client.query(`update page_versions set body_md = '前\n\n後' where page_id = $1`, [page.id]);

    expect(await referencedImageNames(ctx.db)).toEqual(new Set(Object.values(names)));
    expect(await cleanupImages(ctx.db, images)).toMatchObject({ listed: 5, unreferenced: 1, deleted: 1 });
    expect(images.files.has(orphan)).toBe(false);
    for (const [where, name] of Object.entries(names)) expect(images.files.has(name), where).toBe(true);
  });

  it("deletes the requests of a page that is permanently deleted", async () => {
    ctx = await setup();
    const page = await newPage();
    const kept = await newPage(BODY, "残すページ");
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "x" },
      { startLine: 9, endLine: 9, replacement: "y" },
    ]);
    await request(kept, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    expect((await accept(page.id, made.itemIds[0]!)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}/trash`)).status).toBe(200);
    const count = async (table: string) => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);
    expect([await count("edit_requests"), await count("edit_request_items")]).toEqual([1, 1]);
    expect((await list(kept.id)).openCount).toBe(1);
  });

  it("saves, autosaves and lists versions as before on a page with requests", async () => {
    ctx = await setup();
    const page = await newPage();
    await request(page, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    const draft = await ctx.call("PUT", `${W}/pages/${page.id}/draft`, { baseVersionId: page.head, title: "ページ", bodyMd: `${BODY}\n下書き` });
    expect(draft.status).toBe(200);
    const saved = await save(page, `${BODY}\n保存`);
    expect(saved.status).toBe(200);
    expect(saved.body.head).toMatchObject({ acceptedItems: 0, keep: true });
    expect((await ctx.call("GET", `${W}/pages/${page.id}/draft`)).body.draft).toBeNull();
    const versions = (await ctx.call("GET", `${W}/pages/${page.id}/versions?limit=10`)).body;
    expect(versions.versions.map((v: any) => v.acceptedItems)).toEqual([0, 0]);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/versions/${page.head}`)).body).toMatchObject({ id: page.head, acceptedItems: 0 });
  });
});
