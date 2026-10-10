import { afterEach, describe, expect, it } from "vitest";
import { PRUNE_BATCH_SIZE, pruneVersions } from "../pages/prune";
import { setup, W, wikiManifest } from "./harness";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined as unknown as typeof ctx;
});

const internal = (method: string, path: string) => ctx.call(method, path, undefined, { authorization: "Bearer internal-token", cookie: "" });

/** 間引きを動かす時刻。JST では 2026-06-20 12:00（日付の変わり目から遠い） */
const NOW = new Date("2026-06-20T03:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function newPage(title = "A") {
  const page = (await ctx.call("POST", `${W}/pages`, { title, bodyMd: "x" })).body;
  return { id: page.id as string, head: page.headVersionId as string };
}

/** 版を、できた時刻を指定して直接入れる（既定は自動でできた版）。ページの head は動かさない */
async function addVersion(pageId: string, createdAt: Date | string, opts: { keep?: boolean; base?: string | null; grant?: string } = {}) {
  const at = typeof createdAt === "string" ? createdAt : createdAt.toISOString();
  const res = await ctx.client.query<{ id: string }>(
    `insert into page_versions (page_id, base_version_id, title, body_md, author_type, keep, oauth_grant_id, created_at)
     values ($1, $2, 'A', $3, 'human', $4, $5, $6::timestamptz) returning id`,
    [pageId, opts.base ?? null, `body ${at}`, opts.keep ?? false, opts.grant ?? null, at],
  );
  return res.rows[0]!.id;
}

async function versionIds(pageId?: string) {
  const res = pageId
    ? await ctx.client.query<{ id: string }>(`select id from page_versions where page_id = $1`, [pageId])
    : await ctx.client.query<{ id: string }>(`select id from page_versions`);
  return new Set(res.rows.map((r) => r.id));
}

/** 残っている版と消えた版を確かめる */
async function expectVersions(kept: string[], gone: string[]) {
  const ids = await versionIds();
  expect(kept.filter((id) => !ids.has(id))).toEqual([]);
  expect(gone.filter((id) => ids.has(id))).toEqual([]);
}

describe("pruning automatic versions", () => {
  it("keeps everything from the last 24 hours, one per day up to 30 days, and one per month before that", async () => {
    ctx = await setup();
    const a = await newPage();
    // 24時間以内：すべて残る（同じ日に何個あっても）
    const recent = [await addVersion(a.id, ago(1 * HOUR)), await addVersion(a.id, ago(2 * HOUR)), await addVersion(a.id, ago(23 * HOUR))];
    // 2日前（JST 6/18）の同じ日に3つ：いちばん新しい1つになる
    const d2 = [await addVersion(a.id, "2026-06-18T01:00:00Z"), await addVersion(a.id, "2026-06-18T05:00:00Z"), await addVersion(a.id, "2026-06-18T09:00:00Z")];
    // 5日前に1つだけ：残る
    const d5 = await addVersion(a.id, "2026-06-15T05:00:00Z");
    // 40日前あたり（JST の5月）に、別々の日で3つ：いちばん新しい1つになる
    const may = [await addVersion(a.id, "2026-05-08T05:00:00Z"), await addVersion(a.id, "2026-05-10T05:00:00Z"), await addVersion(a.id, "2026-05-12T05:00:00Z")];
    // その前の月（4月）は別の区切り
    const apr = [await addVersion(a.id, "2026-04-03T05:00:00Z"), await addVersion(a.id, "2026-04-20T05:00:00Z")];
    // ほかのページの版は、順位を別に付ける（同じ日の同じ時刻でも、どちらも残る）
    const b = await newPage("B");
    const other = [await addVersion(b.id, "2026-06-18T08:00:00Z"), await addVersion(b.id, "2026-05-11T05:00:00Z")];

    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 5 });
    await expectVersions(
      [a.head, b.head, ...recent, d2[2]!, d5, may[2]!, apr[1]!, ...other],
      [d2[0]!, d2[1]!, may[0]!, may[1]!, apr[0]!],
    );
    // 続けて実行しても、何も消さない
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 0 });
    expect(await pruneVersions(ctx.db, new Date(NOW.getTime() + HOUR))).toEqual({ deleted: 0 });
  });

  it("deletes only versions older than 24 hours, but ranks them together with the newer ones", async () => {
    ctx = await setup();
    const a = await newPage();
    // 同じ日（JST 6/19）：16時間前、ちょうど24時間前、24時間と1ミリ秒前、25時間前
    const h16 = await addVersion(a.id, ago(16 * HOUR));
    const h24 = await addVersion(a.id, ago(24 * HOUR));
    const justOver = await addVersion(a.id, ago(24 * HOUR + 1));
    const h25 = await addVersion(a.id, ago(25 * HOUR));
    // 24時間より前の版だけで順位を付けると justOver がいったん残ってしまう。24時間以内の版も入れて付ける
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 2 });
    await expectVersions([h16, h24], [justOver, h25]);
    // 1ミリ秒たつと、ちょうど24時間前だった版も消える
    expect(await pruneVersions(ctx.db, new Date(NOW.getTime() + 1))).toEqual({ deleted: 1 });
    await expectVersions([h16], [h24]);
  });

  it("splits days at midnight JST, not UTC", async () => {
    ctx = await setup();
    const a = await newPage();
    // JST 6/17 の 00:30・10:00・23:59 と、JST 6/18 の 00:00。UTC では 6/16 が1つ、6/17 が3つ
    const jst17a = await addVersion(a.id, "2026-06-16T15:30:00Z");
    const jst17b = await addVersion(a.id, "2026-06-17T01:00:00Z");
    const jst17c = await addVersion(a.id, "2026-06-17T14:59:59.999Z");
    const jst18 = await addVersion(a.id, "2026-06-17T15:00:00Z");
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 2 });
    await expectVersions([jst17c, jst18], [jst17a, jst17b]);
  });

  it("switches from days to months at 30 days, and splits months at midnight JST", async () => {
    ctx = await setup();
    const a = await newPage();
    // 30日前は 2026-05-21T03:00Z。ちょうど30日前の版は、まだ1日の区切り（JST 5/21）
    const day30 = await addVersion(a.id, ago(30 * DAY));
    const day30Earlier = await addVersion(a.id, "2026-05-21T04:00:00Z");
    // 30日と1ミリ秒前からは1か月の区切り（JST の5月）。同じ JST 5/21 でも、1日の区切りの版とは別に数える
    const month5Newest = await addVersion(a.id, ago(30 * DAY + 1));
    const month5 = await addVersion(a.id, "2026-05-10T00:00:00Z");
    // JST 5/1 00:00 は5月、JST 4/30 23:59 は4月（UTC ではどちらも 4/30）
    const month5First = await addVersion(a.id, "2026-04-30T15:00:00Z");
    const month4Last = await addVersion(a.id, "2026-04-30T14:59:59.999Z");
    const month4 = await addVersion(a.id, "2026-04-30T01:00:00Z");

    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 4 });
    await expectVersions([day30Earlier, month5Newest, month4Last], [day30, month5, month5First, month4]);
  });

  it("does not mix a day with the month that starts on the same date", async () => {
    ctx = await setup();
    const a = await newPage();
    // 30日前の境目が JST 6/1 の中にあるとき。1日の区切り「6/1」と1か月の区切り「6月」は、どちらも 6/1 から始まる
    const now = new Date("2026-07-01T03:00:00Z");
    const inDay = await addVersion(a.id, "2026-06-01T04:00:00Z");
    const inMonth = await addVersion(a.id, "2026-05-31T16:00:00Z");
    expect(await pruneVersions(ctx.db, now)).toEqual({ deleted: 0 });
    await expectVersions([inDay, inMonth], []);
  });

  it("thins further only when time moves a version from a day to a month", async () => {
    ctx = await setup();
    const a = await newPage();
    const v1 = await addVersion(a.id, "2026-06-10T05:00:00Z");
    const v2 = await addVersion(a.id, "2026-06-12T05:00:00Z");
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 0 });
    // 40日後：どちらも30日より前になり、同じ月の1つだけが残る
    expect(await pruneVersions(ctx.db, new Date(NOW.getTime() + 40 * DAY))).toEqual({ deleted: 1 });
    await expectVersions([v2], [v1]);
  });

  it("never deletes kept versions, and does not count them when ranking", async () => {
    ctx = await setup();
    const a = await newPage();
    // 同じ日に、残す版（⌘S など）がいくつあっても消さない。自動の版のうちいちばん新しい1つも残す
    const kept = [
      await addVersion(a.id, "2026-06-18T02:00:00Z", { keep: true }),
      await addVersion(a.id, "2026-06-18T04:00:00Z", { keep: true }),
      await addVersion(a.id, "2026-06-18T09:00:00Z", { keep: true }),
    ];
    const auto1 = await addVersion(a.id, "2026-06-18T03:00:00Z");
    const auto2 = await addVersion(a.id, "2026-06-18T05:00:00Z");
    // 何年も前の残す版も消さない
    const old = [await addVersion(a.id, "2024-01-05T00:00:00Z", { keep: true }), await addVersion(a.id, "2024-01-06T00:00:00Z", { keep: true })];
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 1 });
    await expectVersions([a.head, ...kept, auto2, ...old], [auto1]);
  });

  it("does not delete versions that something still points at, even when they are not the newest of the day", async () => {
    ctx = await setup();
    const a = await newPage();
    const b = await newPage("B");
    const c = await newPage("C");
    const day = (h: number) => `2026-06-18T${String(h).padStart(2, "0")}:00:00Z`;
    // 同じ日のいちばん新しい自動の版。下の版はどれも2番目以降になる
    const newest = await addVersion(a.id, day(12));
    const unprotected = await addVersion(a.id, day(1));

    // head（最新の版）
    const head = await addVersion(a.id, day(2));
    await ctx.client.query(`update pages set head_version_id = $1 where id = $2`, [head, a.id]);
    // 公開中の版
    const published = await addVersion(a.id, day(3));
    await ctx.client.query(`update pages set published_version_id = $1, visibility = 'public', first_published_at = now() where id = $2`, [published, a.id]);
    // 予約が指す版。終わった・取り消した・失敗した予約の行も、外部キーで版を指したまま残る
    const scheduled: string[] = [];
    for (const [i, status] of (["scheduled", "running", "done", "failed", "canceled"] as const).entries()) {
      const v = await addVersion(a.id, day(5 + i));
      scheduled.push(v);
      await ctx.client.query(
        `insert into scheduled_actions (wiki_id, action_type, page_id, version_id, target_visibility, run_at, status)
         select wiki_id, 'publish_page', id, $2, 'public', now() + interval '1 day', $3 from pages where id = $1`,
        [a.id, v, status],
      );
    }
    // 下書きがもとにしている版（古い版をもとにした下書き）
    const draftBase = await addVersion(a.id, day(10));
    await ctx.client.query(`insert into page_drafts (page_id, author_email, base_version_id, title, body_md) values ($1, 'x@example.com', $2, 'A', 'draft')`, [a.id, draftBase]);
    // 外部のアプリ（MCP）が作った版の派生元。null にすると、そのアプリが「作ったページ」に見えてしまう
    await ctx.client.query(`insert into oauth_clients (id, name, redirect_uris) values ('client1', 'App', '[]'::jsonb)`);
    const grant = (
      await ctx.client.query<{ id: string }>(
        `insert into oauth_grants (client_id, user_email, scopes, expires_at) values ('client1', 'x@example.com', '[]'::jsonb, now() + interval '1 day') returning id`,
      )
    ).rows[0]!.id;
    const mcpBase = await addVersion(a.id, day(11));
    const mcpVersion = await addVersion(a.id, "2026-06-19T00:00:00Z", { keep: true, base: mcpBase, grant });

    // ほかのページの版を指していても（head・公開中は外部キーが無い）消さない
    const bNewest = await addVersion(b.id, day(12));
    const cOld = await addVersion(c.id, day(1));
    const cNewest = await addVersion(c.id, day(12));
    await ctx.client.query(`update pages set published_version_id = $1, visibility = 'public' where id = $2`, [cOld, b.id]);

    const before = await wikiManifest(ctx.db);
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 1 });
    await expectVersions(
      [newest, head, published, ...scheduled, draftBase, mcpBase, mcpVersion, bNewest, cOld, cNewest, b.head, c.head],
      [unprotected],
    );
    // 公開サイトの内容は変わらない
    expect(await wikiManifest(ctx.db)).toEqual(before);
    const kept = await ctx.client.query<{ base_version_id: string }>(`select base_version_id from page_versions where id = $1`, [mcpVersion]);
    expect(kept.rows[0]!.base_version_id).toBe(mcpBase);

    // 指しているものが無くなれば、次の回で消える（予約の行は残り続けるので、予約が指す版はずっと残る）
    await ctx.client.query(`delete from page_drafts where page_id = $1`, [a.id]);
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 1 });
    await expectVersions([newest, head, published, ...scheduled, mcpBase], [draftBase]);
  });

  it("clears base_version_id of versions that were based on a deleted one", async () => {
    ctx = await setup();
    const a = await newPage();
    // gone1 ← gone2 ← kept と続く。gone1 と gone2 はどちらも消える
    const gone1 = await addVersion(a.id, "2026-06-18T01:00:00Z", { base: a.head });
    const gone2 = await addVersion(a.id, "2026-06-18T02:00:00Z", { base: gone1 });
    const kept = await addVersion(a.id, "2026-06-18T03:00:00Z", { keep: true, base: gone2 });
    const newest = await addVersion(a.id, "2026-06-18T04:00:00Z", { base: kept });
    const next = await addVersion(a.id, "2026-06-19T04:00:00Z", { keep: true, base: newest });

    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 2 });
    await expectVersions([a.head, kept, newest, next], [gone1, gone2]);
    const bases = await ctx.client.query<{ id: string; base_version_id: string | null }>(`select id, base_version_id from page_versions where page_id = $1`, [a.id]);
    const baseOf = Object.fromEntries(bases.rows.map((r) => [r.id, r.base_version_id]));
    expect(baseOf[kept]).toBeNull();
    // 残った版を指している派生元は、そのまま
    expect(baseOf[newest]).toBe(kept);
    expect(baseOf[next]).toBe(newest);
  });

  it("deletes at most a fixed number of versions per run, and finishes on later runs", async () => {
    ctx = await setup();
    const a = await newPage();
    const newest = await addVersion(a.id, "2026-06-18T12:00:00Z");
    await ctx.client.query(
      `insert into page_versions (page_id, title, body_md, author_type, keep, created_at)
       select $1, 'A', 'x', 'human', false, '2026-06-18T01:00:00Z'::timestamptz + (n || ' seconds')::interval from generate_series(1, $2::int) n`,
      [a.id, PRUNE_BATCH_SIZE + 5],
    );
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: PRUNE_BATCH_SIZE });
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 5 });
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 0 });
    expect(await versionIds(a.id)).toEqual(new Set([a.head, newest]));
  });

  it("thins versions of deleted pages by the same rule, and keeps their head", async () => {
    ctx = await setup();
    const a = await newPage();
    const old = await addVersion(a.id, "2026-06-18T01:00:00Z");
    const newest = await addVersion(a.id, "2026-06-18T02:00:00Z");
    await ctx.call("DELETE", `${W}/pages/${a.id}`);
    expect(await pruneVersions(ctx.db, NOW)).toEqual({ deleted: 1 });
    await expectVersions([a.head, newest], [old]);
  });

  it("runs from the internal route, and the pruned version is gone from the history", async () => {
    ctx = await setup();
    const a = await newPage();
    // 経路は「いま」で動くので、いまから数えた時刻で入れる。同じ JST の日に2つ（3日前の JST 正午と、その1時間後）
    const noonJst = new Date(Math.floor((Date.now() + 9 * HOUR) / DAY) * DAY - 9 * HOUR + 12 * HOUR - 3 * DAY);
    const old = await addVersion(a.id, noonJst);
    const newest = await addVersion(a.id, new Date(noonJst.getTime() + HOUR));

    expect((await ctx.app.request("/internal/versions/prune", { method: "POST" })).status).toBe(401);
    expect((await internal("POST", "/internal/versions/prune")).body).toEqual({ deleted: 1 });
    expect((await internal("POST", "/internal/versions/prune")).body).toEqual({ deleted: 0 });

    const list = (await ctx.call("GET", `${W}/pages/${a.id}/versions`)).body.versions;
    expect(list.map((v: any) => v.id).sort()).toEqual([a.head, newest].sort());
    expect((await ctx.call("GET", `${W}/pages/${a.id}/versions/${old}`)).status).toBe(404);
    expect((await ctx.call("GET", `${W}/pages/${a.id}/versions/${newest}`)).status).toBe(200);
    // 最新の版はそのままで、続きを保存できる
    const saved = await ctx.call("PUT", `${W}/pages/${a.id}`, { baseVersionId: a.head, title: "A", bodyMd: "next" });
    expect(saved.status).toBe(200);
  });
});
