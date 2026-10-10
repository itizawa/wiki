import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";

/** できてからこれだけの版は、順位にかかわらずすべて残す */
export const PRUNE_KEEP_ALL_MS = 24 * 60 * 60_000;
/** ここまでは JST の1日に1つ、これより前は JST の1か月に1つ残す */
export const PRUNE_DAILY_MS = 30 * 24 * 60 * 60_000;
/** 1回に消す版の上限。残りは次の回に回す */
export const PRUNE_BATCH_SIZE = 1000;

/**
 * 自動でできた版（`keep = false`）を、古いほど粗く間引く（Cron のワーカーが1日1回呼ぶ）。消した版は戻せない。
 *
 * - 自動の版を、ページごとに区切り（30日以内は JST の1日、それより前は JST の1か月）に分け、新しい順に順位を付ける
 * - 区切りの中でいちばん新しい版は残す。2番目以降のうち、できてから24時間より前のものを消す
 * - 順位は、24時間以内の版と下の「消さない版」も入れて付ける。残す版（`keep = true`）は入れない
 * - 2番目以降でも消さない版：どれかのページの head・公開中・承認した版、予約（状態は問わない）が指す版、
 *   下書きがもとにしている版、外部のアプリ（MCP）が作った版の派生元
 * - 消した版を派生元（`base_version_id`）にしていた版は、派生元を null にする
 *
 * 続けて呼んでも結果は変わらない。時間がたって区切りが変わったとき（1日 → 1か月）にだけ、さらに減る。
 * 返すのは消した版の数。
 */
export async function pruneVersions(db: Db, now = new Date()): Promise<{ deleted: number }> {
  const keepAllSince = new Date(now.getTime() - PRUNE_KEEP_ALL_MS).toISOString();
  const dailySince = new Date(now.getTime() - PRUNE_DAILY_MS).toISOString();
  return db.transaction(async (tx) => {
    // JST は夏時間が無いので、UTC に9時間を足して日と月を切る（DB のタイムゾーンの設定に左右されない）。
    // 1日の区切りと1か月の区切りが同じ値（月の1日）になっても混ざらないよう、どちらの区切りかも分け方に入れる。
    // `d.keep = false` を消す行そのものの条件に置く：選んだあとに公開・承認で残す版になった行は、ここで外れる。
    const deleted = rowsOf<{ id: string }>(
      await tx.execute(sql`
        delete from "page_versions" d
        where d."keep" = false
          and d."id" in (
            select r."id"
            from (
              select
                v."id",
                v."created_at",
                row_number() over (
                  partition by
                    v."page_id",
                    v."created_at" >= ${dailySince}::timestamptz,
                    case
                      when v."created_at" >= ${dailySince}::timestamptz
                        then date_trunc('day', (v."created_at" at time zone 'UTC') + interval '9 hours')
                      else date_trunc('month', (v."created_at" at time zone 'UTC') + interval '9 hours')
                    end
                  order by v."created_at" desc, v."id" desc
                ) as rn
              from "page_versions" v
              where v."keep" = false
            ) r
            where r.rn > 1
              and r."created_at" < ${keepAllSince}::timestamptz
              and not exists (
                select 1 from "pages" p
                where p."head_version_id" = r."id" or p."published_version_id" = r."id" or p."approved_version_id" = r."id"
              )
              and not exists (select 1 from "scheduled_actions" a where a."version_id" = r."id")
              and not exists (select 1 from "page_drafts" dr where dr."base_version_id" = r."id")
              -- 派生元が null になると「その連携が作ったページ」の判定（最初の版を作った連携）に当たってしまう
              and not exists (
                select 1 from "page_versions" c where c."base_version_id" = r."id" and c."oauth_grant_id" is not null
              )
            order by r."created_at", r."id"
            limit ${PRUNE_BATCH_SIZE}
          )
        returning d."id"
      `),
    );
    if (deleted.length > 0) {
      const ids = sql.join(
        deleted.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      );
      await tx.execute(sql`update "page_versions" set "base_version_id" = null where "base_version_id" in (${ids})`);
    }
    return { deleted: deleted.length };
  });
}
