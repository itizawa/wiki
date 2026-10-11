import { IMAGE_NAME_PATTERN, imageNameFromPath } from "@wiki/shared";
import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";
import { R2_PAGE_SIZE, type ImageStore } from "./store";

/** アップロードからこれだけのあいだは、どこからも参照されていなくても消さない（貼ったばかりで、まだ保存されていない画像を消さないため） */
export const IMAGE_CLEANUP_KEEP_MS = 30 * 24 * 60 * 60_000;
/** 1回の掃除で一覧から読む画像の上限。これより多く置いてあると、名前の順で後ろの画像までは見ない（`truncated` が true になる） */
export const IMAGE_CLEANUP_MAX_LISTED = 20_000;
/** 1回の掃除で消す画像の上限。残りは次の回（1週間後）に回す */
export const IMAGE_CLEANUP_MAX_DELETED = 1000;

export type CleanupImagesResult = {
  /** 一覧から読んだ数 */
  listed: number;
  /** 読む上限に当たって、全部は見ていない */
  truncated: boolean;
  /** 読んだうち、どこからも参照されておらず、アップロードから30日より古いものの数 */
  unreferenced: number;
  /** 消した数（`unreferenced` より少なければ、残りは次の回） */
  deleted: number;
};

/**
 * どこかから参照されている画像の名前を集める。
 *
 * 本文などの文字列から `/images/{name}` の形を DB の中で拾い、重なりを除いた名前だけを受け取る
 * （版の本文をこちらのメモリに載せない）。見る先は、画像のパスを書ける場所のすべて：
 *
 * - `page_versions.body_md`：すべての版。ゴミ箱のページ・アーカイブ中の wiki の版も含む。
 *   完全に削除したページは版ごと消えているので、そのページだけが使っていた画像は参照が無くなる
 * - `page_drafts.body_md`：下書き
 * - `page_templates.body_md`：テンプレート
 * - `edit_request_items.original_md` / `replacement_md`：編集リクエストの項目の、元の文面と置き換え案（状態は問わない。
 *   未対応の提案の中でだけ使っている画像も、採用されるまで消さない）
 * - `wikis.icon_url`（wiki の画像）、`wikis.theme`（ロゴ・ファビコン）、`wikis.home`（トップページの自由記述）。アーカイブ中の wiki も含む
 *
 * ページのアイコン（`pages.icon`）は絵文字だけなので見ない。
 * 編集リクエストの、提案の理由（`edit_request_items.reason`）・指摘の本文（`note_body`）・返信（`edit_request_comments.body`）・
 * 全体へのひとこと（`edit_requests.comment`）も見ない。どれもプレーンテキストとして出すだけで、画像は描かない
 * （`/images/{name}` という文字が書かれていても、その画像を使っていることにはしない）。
 * **画像のパスを書ける列を足したら、ここにも足す**（足し忘れると、そこでだけ使っている画像が消える）。
 */
export async function referencedImageNames(db: Db): Promise<Set<string>> {
  const pattern = `/images/(${IMAGE_NAME_PATTERN})`;
  const names = (text: ReturnType<typeof sql>, from: ReturnType<typeof sql>) =>
    sql`select (regexp_matches(${text}, ${pattern}::text, 'g'))[1] as name from ${from} where ${text} like '%/images/%'`;
  const rows = rowsOf<{ name: string }>(
    await db.execute(sql`
      select distinct name from (
        ${names(sql`"body_md"`, sql`"page_versions"`)}
        union all
        ${names(sql`"body_md"`, sql`"page_drafts"`)}
        union all
        ${names(sql`"body_md"`, sql`"page_templates"`)}
        union all
        ${names(sql`"original_md"`, sql`"edit_request_items"`)}
        union all
        ${names(sql`"replacement_md"`, sql`"edit_request_items"`)}
        union all
        ${names(sql`concat_ws(' ', "icon_url", "theme"::text, "home"::text)`, sql`"wikis"`)}
      ) refs
    `),
  );
  return new Set(rows.map((r) => r.name));
}

/**
 * どこからも参照されず、アップロードから30日より古い画像を消す（Cron のワーカーが週1回呼ぶ）。**消した画像は戻せない**。
 *
 * - 消さないもの：参照されている画像（`referencedImageNames`）、アップロードから30日以内の画像、
 *   名前が画像の形（`newImageName` が作る形）でないもの（ここで置いたものではないので触らない）
 * - 置き場所の一覧を先に読み、そのあとで参照を集める（一覧を読んでいるあいだに保存された参照を取りこぼさない）
 * - 読む数と消す数に上限がある。消す前に、件数をログに出す
 */
export async function cleanupImages(
  db: Db,
  store: ImageStore,
  now = new Date(),
  limits: { maxListed?: number; maxDeleted?: number } = {},
): Promise<CleanupImagesResult> {
  const maxListed = limits.maxListed ?? IMAGE_CLEANUP_MAX_LISTED;
  const maxDeleted = limits.maxDeleted ?? IMAGE_CLEANUP_MAX_DELETED;
  const olderThan = now.getTime() - IMAGE_CLEANUP_KEEP_MS;

  const old: string[] = [];
  let listed = 0;
  let cursor: string | undefined;
  let truncated = false;
  do {
    const page = await store.list({ limit: Math.min(R2_PAGE_SIZE, maxListed - listed), ...(cursor && { cursor }) });
    listed += page.objects.length;
    for (const o of page.objects) {
      if (o.uploaded.getTime() < olderThan && imageNameFromPath(`/images/${o.name}`) === o.name) old.push(o.name);
    }
    cursor = page.cursor ?? undefined;
    if (cursor && listed >= maxListed) truncated = true;
  } while (cursor && !truncated);

  const referenced = old.length > 0 ? await referencedImageNames(db) : new Set<string>();
  const unreferenced = old.filter((name) => !referenced.has(name));
  const doomed = unreferenced.slice(0, maxDeleted);
  console.log(
    JSON.stringify({
      imageCleanup: { listed, truncated, old: old.length, referenced: referenced.size, unreferenced: unreferenced.length, deleting: doomed.length },
    }),
  );
  if (doomed.length > 0) await store.delete(doomed);
  return { listed, truncated, unreferenced: unreferenced.length, deleted: doomed.length };
}
