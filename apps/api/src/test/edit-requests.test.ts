import { EDIT_REQUEST_LIMITS, IMAGE_NAME_PATTERN, type CreateEditRequestInput, type EditRequestComment, type PageEditRequests } from "@wiki/shared";
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

/** 編集リクエストを出す（MCP の道具と、管理画面から出す API が呼ぶ関数を、直接呼ぶ） */
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
    // 指摘の本文と返信はプレーンテキスト。画像のパスが書かれていても、使っていることにはしない
    const noted = await request(page, [{ kind: "note", startLine: 1, endLine: 1, body: `この図（/images/${orphan}）は古い` }]);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${noted.itemIds[0]}/comments`, { body: `![図](/images/${orphan})` })).status).toBe(201);
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
    // 返信も、項目といっしょに消える
    const keptItem = (await itemsOf(kept.id))[0]!;
    for (const [pageId, itemId] of [[page.id, made.itemIds[0]], [page.id, made.itemIds[1]], [kept.id, keptItem.id]]) {
      expect((await ctx.call("POST", `${W}/pages/${pageId}/edit-request-items/${itemId}/comments`, { body: "返信" })).status).toBe(201);
    }
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}/trash`)).status).toBe(200);
    const count = async (table: string) => Number((await ctx.client.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n);
    expect([await count("edit_requests"), await count("edit_request_items"), await count("edit_request_comments")]).toEqual([1, 1, 1]);
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

describe("making an edit request from the admin screen (POST edit-requests)", () => {
  const post = (pageId: string, body: unknown, call = ctx.call) => call("POST", `${W}/pages/${pageId}/edit-requests`, body);

  it("makes a request as the signed-in member, and lists it the same way as one made over MCP", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const res = await post(
      page.id,
      {
        baseVersionId: page.head,
        comment: "  読みやすくする案  ",
        items: [
          { startLine: 5, endLine: 7, replacement: "- まとめた", reason: "3つは多い" },
          { startLine: 3, endLine: 3, replacement: "" },
        ],
      },
      editor.call,
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), itemIds: [expect.any(String), expect.any(String)] });

    const body = await list(page.id);
    expect(body.openCount).toBe(2);
    expect(body.requests).toHaveLength(1);
    // 画面から出したものは、アプリの名前（via）が付かない。ほかは、MCP から出したものと同じ形
    expect(body.requests[0]).toMatchObject({ id: res.body.id, comment: "読みやすくする案", createdBy: { id: editor.user.id }, via: null });
    expect(body.requests[0]!.items.map((i) => i.id)).toEqual(res.body.itemIds);
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
    });
    // 本文は変わらない
    expect((await getPage(page.id)).headVersionId).toBe(page.head);
    // ほかの人が採用でき、出した本人だけが取り下げられる
    expect((await accept(page.id, res.body.itemIds[0])).status).toBe(200);
    const withdraw = `${W}/pages/${page.id}/edit-requests/${res.body.id}/withdraw`;
    expect((await ctx.call("POST", withdraw)).body.error).toMatchObject({ code: "not_requester" });
    expect((await editor.call("POST", withdraw)).body).toEqual({ withdrawn: 1 });
  });

  it("stops with 409 when someone made a version in the meantime, and leaves nothing behind", async () => {
    ctx = await setup();
    const page = await newPage();
    const input = { baseVersionId: page.head, items: [{ startLine: 3, endLine: 3, replacement: "x" }] };
    const saved = await save(page, `足した\n\n${BODY}`);
    expect(saved.status).toBe(200);
    const res = await post(page.id, input);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "version_conflict", details: { headVersionId: saved.body.headVersionId } });
    expect((await list(page.id)).requests).toEqual([]);
    // 読み直した版をもとに、ずれた行で出し直せる
    const again = await post(page.id, { baseVersionId: saved.body.headVersionId, items: [{ startLine: 5, endLine: 5, replacement: "x" }] });
    expect(again.status).toBe(201);
    expect((await itemsOf(page.id))[0]).toMatchObject({ originalText: "1段落目", replacement: "x" });
  });

  it("checks the input the same way as MCP", async () => {
    ctx = await setup();
    const page = await newPage();
    const item = { startLine: 3, endLine: 3, replacement: "x" };
    const code = async (body: unknown) => {
      const res = await post(page.id, body);
      return [res.status, res.body.error?.code];
    };
    expect(await code({ baseVersionId: page.head, items: [{ ...item, endLine: 10 }] })).toEqual([400, "line_out_of_range"]);
    expect(await code({ baseVersionId: page.head, items: [{ startLine: 9, endLine: 9, replacement: "最後の段落" }] })).toEqual([400, "no_change"]);
    expect(await code({ baseVersionId: page.head, items: [] })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: page.head, items: [{ ...item, startLine: 4 }] })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: "not-a-uuid", items: [item] })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: page.head, items: Array.from({ length: EDIT_REQUEST_LIMITS.items + 1 }, () => item) })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: page.head, items: [{ ...item, replacement: "x".repeat(EDIT_REQUEST_LIMITS.replacement + 1) }] })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: page.head, items: [{ ...item, reason: "x".repeat(EDIT_REQUEST_LIMITS.reason + 1) }] })).toEqual([400, "invalid_input"]);
    expect(await code({ baseVersionId: page.head, comment: "x".repeat(EDIT_REQUEST_LIMITS.comment + 1), items: [item] })).toEqual([400, "invalid_input"]);
    expect((await list(page.id)).requests).toEqual([]);
  });

  it("treats a page of another wiki, a page in the trash and an archived wiki as not found", async () => {
    ctx = await setup();
    const page = await newPage();
    const input = { baseVersionId: page.head, items: [{ startLine: 3, endLine: 3, replacement: "x" }] };
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    const other = (await ctx.call("POST", "/admin/w/notes/pages", { title: "別の wiki", bodyMd: BODY })).body;
    expect((await ctx.call("POST", `/admin/w/notes/pages/${page.id}/edit-requests`, input)).status).toBe(404);
    const outsider = await ctx.addUser("outsider@example.com", { notes: "editor" });
    expect((await post(page.id, input, outsider.call)).status).toBe(404);
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await post(page.id, input)).status).toBe(404);
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    expect((await ctx.call("POST", `/admin/w/notes/pages/${other.id}/edit-requests`, { ...input, baseVersionId: other.headVersionId })).status).toBe(404);
  });
});

describe("notes (items without a replacement)", () => {
  const itemPath = (pageId: string, itemId: string, action: string) => `${W}/pages/${pageId}/edit-request-items/${itemId}/${action}`;

  it("makes a note with a body and no replacement, next to a suggestion, and counts both as open", async () => {
    ctx = await setup();
    const page = await newPage();
    const res = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests`, {
      baseVersionId: page.head,
      items: [
        { kind: "note", startLine: 5, endLine: 7, body: "  根拠が不明です。\n出典はありますか？  " },
        { kind: "suggestion", startLine: 3, endLine: 3, replacement: "x" },
        // 種類を省いたものは、今までどおり提案
        { startLine: 9, endLine: 9, replacement: "" },
      ],
    });
    expect(res.status).toBe(201);
    const body = await list(page.id);
    expect(body.openCount).toBe(3);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests/count`)).body).toEqual({ open: 3 });
    const [note, suggestion, removal] = body.requests[0]!.items;
    expect(note).toMatchObject({
      kind: "note",
      status: "open",
      startLine: 5,
      endLine: 7,
      originalText: "- a\n- b\n- c",
      // 前後の空白は落とす。中の改行は残す
      body: "根拠が不明です。\n出典はありますか？",
      replacement: null,
      reason: null,
      current: { startLine: 5, endLine: 7 },
      stale: null,
      comments: [],
    });
    expect(suggestion).toMatchObject({ kind: "suggestion", replacement: "x", body: null });
    // 行を消す提案（空の文字）は、置き換え案が無いこと（null）とは別
    expect(removal).toMatchObject({ kind: "suggestion", replacement: "", body: null });
  });

  it("refuses a note without a body, with a replacement or a reason, or with a body that is too long", async () => {
    ctx = await setup();
    const page = await newPage();
    const post = (item: unknown) => ctx.call("POST", `${W}/pages/${page.id}/edit-requests`, { baseVersionId: page.head, items: [item] });
    const at = { startLine: 3, endLine: 3 };
    for (const item of [
      { kind: "note", ...at },
      { kind: "note", ...at, body: "   " },
      { kind: "note", ...at, body: "x", replacement: "y" },
      { kind: "note", ...at, body: "x", reason: "y" },
      { kind: "note", ...at, body: "x".repeat(EDIT_REQUEST_LIMITS.note + 1) },
      { kind: "note", startLine: 3, endLine: 2, body: "x" },
      { kind: "comment", ...at, body: "x" },
      // 提案には、今までどおり置き換え案が要る
      { kind: "suggestion", ...at, body: "x" },
      { ...at },
    ]) {
      const res = await post(item);
      expect(res.status, JSON.stringify(item).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
    }
    expect((await post({ kind: "note", startLine: 3, endLine: 10, body: "x" })).body.error.code).toBe("line_out_of_range");
    expect((await post({ kind: "note", ...at, body: "x".repeat(EDIT_REQUEST_LIMITS.note) })).status).toBe(201);
    expect((await list(page.id)).requests).toHaveLength(1);
  });

  it("keeps the shape of each kind in the database too", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { kind: "note", startLine: 3, endLine: 3, body: "指摘" },
      { startLine: 9, endLine: 9, replacement: "y" },
    ]);
    const [note, suggestion] = made.itemIds;
    const set = (id: string | undefined, sql: string) => ctx.client.query(`update edit_request_items set ${sql} where id = $1`, [id]);
    // 指摘：置き換え案・理由を持てない、本文は空にできない、採用・却下にならない
    for (const sql of [`replacement_md = ''`, `reason = 'x'`, `note_body = null`, `note_body = '  '`, `status = 'accepted'`, `status = 'rejected'`, `kind = 'suggestion'`]) {
      await expect(set(note, sql), `note: ${sql}`).rejects.toThrow(/edit_request_items_kind_shape_check/);
    }
    // 提案：置き換え案が要る、本文を持てない、解決済みにならない
    for (const sql of [`replacement_md = null`, `note_body = 'x'`, `status = 'resolved'`, `kind = 'note'`]) {
      await expect(set(suggestion, sql), `suggestion: ${sql}`).rejects.toThrow(/edit_request_items_kind_shape_check/);
    }
    await expect(set(note, `status = 'done'`)).rejects.toThrow(/edit_request_items_status_check/);
    await expect(set(note, `kind = 'question'`)).rejects.toThrow(/edit_request_items_kind/);
    // 通るもの：行を消す提案（空の文字）、解決済みの指摘
    await expect(set(suggestion, `replacement_md = ''`)).resolves.toBeTruthy();
    await expect(set(note, `status = 'resolved'`)).resolves.toBeTruthy();
  });

  it("resolves an open note and puts a resolved one back to open", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [{ kind: "note", startLine: 3, endLine: 3, body: "ここは古いかもしれない" }]);
    const path = (action: string) => itemPath(page.id, made.itemIds[0]!, action);

    const reopenOpen = await ctx.call("POST", path("reopen"));
    expect(reopenOpen.status).toBe(409);
    expect(reopenOpen.body.error.code).toBe("not_resolved");
    expect((await editor.call("POST", path("resolve"))).status).toBe(200);
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "resolved", decidedBy: { id: editor.user.id, name: "editor" }, current: { startLine: 3, endLine: 3 }, stale: null });
    expect((await list(page.id)).openCount).toBe(0);
    const again = await ctx.call("POST", path("resolve"));
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "not_open", details: { status: "resolved" } });
    // 本文は変わらない
    expect((await getPage(page.id)).headVersionId).toBe(page.head);

    expect((await ctx.call("POST", path("reopen"))).status).toBe(200);
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "open", decidedBy: null, decidedAt: null });
    expect((await list(page.id)).openCount).toBe(1);
  });

  it("answers with a clear error for an action that does not fit the kind", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { kind: "note", startLine: 3, endLine: 3, body: "指摘" },
      { startLine: 9, endLine: 9, replacement: "y" },
    ]);
    const [note, suggestion] = made.itemIds as [string, string];
    // 指摘は、採用も却下もできない
    for (const action of ["accept", "reject"]) {
      const res = await ctx.call("POST", itemPath(page.id, note, action));
      expect(res.status, action).toBe(409);
      expect(res.body.error.code, action).toBe("not_a_suggestion");
    }
    // 提案は、解決済みにできない
    const res = await ctx.call("POST", itemPath(page.id, suggestion, "resolve"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_a_note");
    expect((await itemsOf(page.id)).map((i) => i.status)).toEqual(["open", "open"]);
    expect((await getPage(page.id)).headVersionId).toBe(page.head);
  });

  it("marks a note stale by the same rule as a suggestion, and still resolves it", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { kind: "note", startLine: 3, endLine: 3, body: "この段落は古い" },
      { kind: "note", startLine: 9, endLine: 9, body: "最後も確かめて" },
    ]);
    // 1段落目を書き換え、前に行を足す
    const saved = await save(page, `足した\n\n${BODY.replace("1段落目", "書き直した")}`);
    expect(saved.status).toBe(200);
    const [gone, moved] = await itemsOf(page.id);
    expect(gone).toMatchObject({ status: "open", stale: "not_found", current: null });
    // 元の文面が残っていれば、ずれた行で場所が分かる
    expect(moved).toMatchObject({ status: "open", stale: null, current: { startLine: 11, endLine: 11 } });
    expect((await list(page.id)).openCount).toBe(2);
    expect((await ctx.call("POST", itemPath(page.id, gone!.id, "resolve"))).status).toBe(200);
    expect((await itemsOf(page.id))[0]).toMatchObject({ status: "resolved", stale: null, current: null });
    expect((await list(page.id)).openCount).toBe(1);
  });

  it("finishes a request when its last open item is resolved, and leaves notes alone when accepting everything", async () => {
    ctx = await setup();
    const page = await newPage();
    const requester = await ctx.addUser("requester@example.com", { wiki: "editor" });
    const made = await request(
      page,
      [
        { startLine: 3, endLine: 3, replacement: "x" },
        { kind: "note", startLine: 5, endLine: 5, body: "a とは？" },
        { startLine: 9, endLine: 9, replacement: "y" },
        { kind: "note", startLine: 7, endLine: 7, body: "c は要る？" },
      ],
      { userId: requester.user.id },
    );
    expect((await list(page.id)).openCount).toBe(4);

    // 「すべて採用」は、提案だけを採用する。指摘は、かけられなかったものにも数えない
    const all = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/accept-all`);
    expect(all.status).toBe(200);
    expect(all.body.applied.map((a: any) => a.itemId)).toEqual([made.itemIds[0], made.itemIds[2]]);
    expect(all.body.skipped).toEqual([]);
    expect((await itemsOf(page.id)).map((i) => i.status)).toEqual(["accepted", "open", "accepted", "open"]);
    expect((await list(page.id)).openCount).toBe(2);
    // 指摘だけが残ったリクエストで「すべて採用」しても、何も起きない
    const none = await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/accept-all`);
    expect(none.body).toMatchObject({ versionId: null, applied: [], skipped: [] });

    // 指摘を1件解決済みにし、もう1件は出した人が取り下げる → 未対応が0件（リクエストは完了）
    expect((await ctx.call("POST", itemPath(page.id, made.itemIds[1]!, "resolve"))).status).toBe(200);
    expect((await list(page.id)).openCount).toBe(1);
    expect((await requester.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/withdraw`)).body).toEqual({ withdrawn: 1 });
    const done = await list(page.id);
    expect(done.openCount).toBe(0);
    expect(done.requests[0]!.items.map((i) => i.status)).toEqual(["accepted", "resolved", "accepted", "withdrawn"]);
    expect((await ctx.call("GET", `${W}/pages/${page.id}/edit-requests/count`)).body).toEqual({ open: 0 });
    // 取り下げた指摘は、解決済みにも、未対応にも戻せない
    expect((await ctx.call("POST", itemPath(page.id, made.itemIds[3]!, "resolve"))).body.error.code).toBe("not_open");
    expect((await ctx.call("POST", itemPath(page.id, made.itemIds[3]!, "reopen"))).body.error.code).toBe("not_resolved");
    // 解決済みを戻すと、また未対応に数える
    expect((await ctx.call("POST", itemPath(page.id, made.itemIds[1]!, "reopen"))).status).toBe(200);
    expect((await list(page.id)).openCount).toBe(1);
  });

  it("does not hand a note to the editor as an applied change", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { kind: "note", startLine: 5, endLine: 5, body: "指摘" },
      { startLine: 3, endLine: 3, replacement: "x" },
    ]);
    expect((await ctx.call("POST", itemPath(page.id, made.itemIds[0]!, "resolve"))).status).toBe(200);
    expect((await accept(page.id, made.itemIds[1]!)).status).toBe(200);
    const applied = (await ctx.call("GET", `${W}/pages/${page.id}/edit-requests/applied?since=${page.head}`)).body;
    expect(applied.steps).toHaveLength(1);
    expect(applied.steps[0].edits).toEqual([{ itemId: made.itemIds[1], originalText: "1段落目", replacement: "x" }]);
  });
});

describe("replies to an item", () => {
  const commentsPath = (pageId: string, itemId: string) => `${W}/pages/${pageId}/edit-request-items/${itemId}/comments`;

  it("adds replies in order, as plain text, from any member", async () => {
    ctx = await setup();
    const page = await newPage();
    const editor = await ctx.addUser("editor@example.com", { wiki: "editor" });
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "x" },
      { kind: "note", startLine: 9, endLine: 9, body: "指摘" },
    ]);
    const text = "  <b>太字</b> と **Markdown** と\nhttps://example.com  ";
    const first = await ctx.call<EditRequestComment>("POST", commentsPath(page.id, made.itemIds[0]!), { body: text });
    expect(first.status).toBe(201);
    // 書いたままの文字で持つ（前後の空白だけ落とす）
    expect(first.body).toMatchObject({ itemId: made.itemIds[0], body: text.trim(), createdBy: { id: ctx.owner.id, name: "オーナー" }, via: null });
    expect((await editor.call("POST", commentsPath(page.id, made.itemIds[0]!), { body: "2つ目" })).status).toBe(201);
    expect((await editor.call("POST", commentsPath(page.id, made.itemIds[1]!), { body: "指摘への返信" })).status).toBe(201);

    const [suggestion, note] = await itemsOf(page.id);
    expect(suggestion!.comments.map((c) => [c.body, c.createdBy.name])).toEqual([
      [text.trim(), "オーナー"],
      ["2つ目", "editor"],
    ]);
    expect(suggestion!.comments[0]!.id).toBe(first.body.id);
    expect(note!.comments.map((c) => c.body)).toEqual(["指摘への返信"]);
    // 返信しても、項目の状態と未対応の数は変わらない
    expect((await list(page.id)).openCount).toBe(2);
  });

  it("checks the body and its length", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    const path = commentsPath(page.id, made.itemIds[0]!);
    for (const body of [{}, { body: "" }, { body: "  \n " }, { body: "x".repeat(EDIT_REQUEST_LIMITS.reply + 1) }, { body: 1 }]) {
      const res = await ctx.call("POST", path, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await ctx.call("POST", path, { body: "x".repeat(EDIT_REQUEST_LIMITS.reply) })).status).toBe(201);
    expect((await itemsOf(page.id))[0]!.comments).toHaveLength(1);
  });

  it("takes replies after the item is accepted, rejected, resolved or withdrawn", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "x" },
      { startLine: 5, endLine: 5, replacement: "- A" },
      { kind: "note", startLine: 7, endLine: 7, body: "指摘" },
      { startLine: 9, endLine: 9, replacement: "y" },
    ]);
    const action = (i: number, name: string) => ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${made.itemIds[i]}/${name}`);
    expect((await action(0, "accept")).status).toBe(200);
    expect((await action(1, "reject")).status).toBe(200);
    expect((await action(2, "resolve")).status).toBe(200);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-requests/${made.id}/withdraw`)).body).toEqual({ withdrawn: 1 });
    for (const itemId of made.itemIds) {
      expect((await ctx.call("POST", commentsPath(page.id, itemId), { body: "あとから" })).status).toBe(201);
    }
    const items = await itemsOf(page.id);
    expect(items.map((i) => [i.status, i.comments.length])).toEqual([
      ["accepted", 1],
      ["rejected", 1],
      ["resolved", 1],
      ["withdrawn", 1],
    ]);
  });

  it("stops at the limit of replies for one item", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [{ startLine: 3, endLine: 3, replacement: "x" }]);
    await ctx.client.query(
      `insert into edit_request_comments (item_id, body, created_by) select $1, 'x', $2 from generate_series(1, ${EDIT_REQUEST_LIMITS.repliesPerItem})`,
      [made.itemIds[0], ctx.owner.id],
    );
    const res = await ctx.call("POST", commentsPath(page.id, made.itemIds[0]!), { body: "もう1つ" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("too_many_replies");
  });

  it("treats an item of another wiki, a page in the trash and an archived wiki as not found", async () => {
    ctx = await setup();
    const page = await newPage();
    const made = await request(page, [
      { startLine: 3, endLine: 3, replacement: "x" },
      { kind: "note", startLine: 9, endLine: 9, body: "指摘" },
    ]);
    const [suggestion, note] = made.itemIds as [string, string];
    expect((await ctx.call("POST", "/admin/wikis", { key: "notes", name: "ノート" })).status).toBe(201);
    const other = (await ctx.call("POST", "/admin/w/notes/pages", { title: "別の wiki", bodyMd: BODY })).body;
    const inNotes = await request({ id: other.id, head: other.headVersionId }, [{ kind: "note", startLine: 3, endLine: 3, body: "別の wiki の指摘" }]);

    for (const [path, body] of [
      // 別の wiki の経路から
      [`/admin/w/notes/pages/${page.id}/edit-request-items/${suggestion}/comments`, { body: "x" }],
      [`/admin/w/notes/pages/${page.id}/edit-request-items/${note}/resolve`, undefined],
      // 自分の wiki のページの経路で、別の wiki の項目を指す
      [`/admin/w/notes/pages/${other.id}/edit-request-items/${suggestion}/comments`, { body: "x" }],
      [`/admin/w/notes/pages/${other.id}/edit-request-items/${note}/resolve`, undefined],
      [`${W}/pages/${page.id}/edit-request-items/${inNotes.itemIds[0]}/comments`, { body: "x" }],
      [`${W}/pages/${page.id}/edit-request-items/${inNotes.itemIds[0]}/resolve`, undefined],
      [`${W}/pages/${page.id}/edit-request-items/not-a-uuid/comments`, { body: "x" }],
      [`${W}/pages/${page.id}/edit-request-items/not-a-uuid/resolve`, undefined],
    ] as const) {
      expect((await ctx.call("POST", path, body)).status, path).toBe(404);
    }
    // その wiki のメンバーでない人
    const outsider = await ctx.addUser("outsider@example.com", { notes: "editor" });
    expect((await outsider.call("POST", commentsPath(page.id, suggestion), { body: "x" })).status).toBe(404);
    expect((await outsider.call("POST", `${W}/pages/${page.id}/edit-request-items/${note}/resolve`)).status).toBe(404);

    // ゴミ箱のページの項目には、返信も解決もできない
    expect((await ctx.call("DELETE", `${W}/pages/${page.id}`)).status).toBe(200);
    expect((await ctx.call("POST", commentsPath(page.id, suggestion), { body: "x" })).status).toBe(404);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${note}/resolve`)).status).toBe(404);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/restore`)).status).toBe(200);
    // アーカイブ中の wiki
    expect((await ctx.call("POST", "/admin/wikis/notes/archive")).status).toBe(200);
    expect((await ctx.call("POST", `/admin/w/notes/pages/${other.id}/edit-request-items/${inNotes.itemIds[0]}/comments`, { body: "x" })).status).toBe(404);
    expect((await ctx.call("POST", `/admin/w/notes/pages/${other.id}/edit-request-items/${inNotes.itemIds[0]}/resolve`)).status).toBe(404);

    // どれも、何も残していない。元に戻したページでは、また返信・解決できる
    expect((await itemsOf(page.id)).map((i) => [i.status, i.comments.length])).toEqual([
      ["open", 0],
      ["open", 0],
    ]);
    expect((await ctx.call("POST", commentsPath(page.id, suggestion), { body: "x" })).status).toBe(201);
    expect((await ctx.call("POST", `${W}/pages/${page.id}/edit-request-items/${note}/resolve`)).status).toBe(200);
  });
});
