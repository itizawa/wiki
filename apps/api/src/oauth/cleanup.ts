import { sql } from "drizzle-orm";
import { rowsOf, type Db } from "../db/client";

/** 期限を過ぎてからこれだけのあいだは、消してよい行も残す（時計のずれや、期限の直後の問い合わせを調べるため） */
export const OAUTH_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60_000;
/** 1回に消す行の上限（トークン・認可コードのそれぞれ）。残りは次の回に回す */
export const OAUTH_CLEANUP_BATCH_SIZE = 5000;

export type CleanupOAuthResult = {
  /** 消した `oauth_tokens` の数 */
  tokens: number;
  /** 消した `oauth_codes` の数 */
  codes: number;
};

/**
 * 役目を終えたトークンと認可コードを消す（Cron のワーカーが1日1回呼ぶ）。許可（`oauth_grants`）は消さない。
 *
 * 消すのは、期限（`expires_at`）を7日より前に過ぎた行のうち、次のもの。
 *
 * - アクセストークン：すべて。期限を過ぎたものは、行があっても無くても通らない（`authenticateAccessToken`）
 * - リフレッシュトークン：許可が取り消し済みか、期限切れのものだけ。
 *   使える許可のリフレッシュトークンは、入れ替え済み・期限切れでも残す。入れ替え済みのトークンがもう一度使われたら
 *   漏れたものとみなして許可ごと取り消す（`refreshTokens`）ので、行が無いと、その検知ができなくなる。
 *   許可は90日で切れるので、残る行は許可1つにつき90日ぶんまで
 * - 認可コード：使われなかったものと、許可が取り消し済みか期限切れのもの。
 *   使える許可の、使ったコードは残す（2回目の使用で許可ごと取り消す。`exchangeCode`）
 *
 * 期限を過ぎていないトークンは消さないので、使われている許可のいまのトークンが消えることは無い。
 * 続けて呼んでも結果は変わらない。返すのは消した数。
 */
export async function cleanupOAuth(db: Db, now = new Date(), batchSize = OAUTH_CLEANUP_BATCH_SIZE): Promise<CleanupOAuthResult> {
  const nowIso = now.toISOString();
  const expiredBefore = new Date(now.getTime() - OAUTH_CLEANUP_GRACE_MS).toISOString();
  const grantDead = sql`(g."revoked_at" is not null or g."expires_at" <= ${nowIso}::timestamptz)`;

  const tokens = rowsOf(
    await db.execute(sql`
      delete from "oauth_tokens"
      where "token_hash" in (
        select t."token_hash"
        from "oauth_tokens" t
        join "oauth_grants" g on g."id" = t."grant_id"
        where t."expires_at" < ${expiredBefore}::timestamptz
          and (t."kind" = 'access' or ${grantDead})
        order by t."expires_at"
        limit ${batchSize}
      )
      returning 1
    `),
  );
  const codes = rowsOf(
    await db.execute(sql`
      delete from "oauth_codes"
      where "code_hash" in (
        select c."code_hash"
        from "oauth_codes" c
        join "oauth_grants" g on g."id" = c."grant_id"
        where c."expires_at" < ${expiredBefore}::timestamptz
          and (c."used_at" is null or ${grantDead})
        order by c."expires_at"
        limit ${batchSize}
      )
      returning 1
    `),
  );
  return { tokens: tokens.length, codes: codes.length };
}
