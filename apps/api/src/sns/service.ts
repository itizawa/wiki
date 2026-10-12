import { xPostUrl, type SnsAccount, type SnsPostResult, type SnsStatus } from "@wiki/shared";
import { and, eq } from "drizzle-orm";
import { type AuditActor, actorUserId, writeAudit } from "../audit/service";
import type { Db } from "../db/client";
import { wikiSnsAccounts } from "../db/schema";
import { HttpError } from "../errors";
import { decryptToken, encryptToken } from "./crypto";
import { XApiError, type XClient } from "./x-client";

type AccountRow = typeof wikiSnsAccounts.$inferSelect;
type Wiki = { id: string; name: string };

/** X の API と、トークンを暗号化する鍵。どちらも、X 連携の設定があるときだけ用意できる。 */
export type XDeps = { client: XClient; tokenKey: string };

/** アクセストークンの期限がこれより近ければ、使う前に更新する */
const REFRESH_MARGIN_MS = 60_000;

const xAccount = (wikiId: string) => and(eq(wikiSnsAccounts.wikiId, wikiId), eq(wikiSnsAccounts.provider, "x"));
/** トークンの暗号化に入れる、どの行のものかの印 */
const tokenContext = (wikiId: string) => `${wikiId}:x`;

function toAccount(row: AccountRow): SnsAccount {
  return { username: row.username, displayName: row.displayName, connectedBy: row.connectedByLabel, connectedAt: row.connectedAt.toISOString() };
}

export async function getSnsStatus(db: Db, wikiId: string, available: boolean): Promise<SnsStatus> {
  const [row] = await db.select().from(wikiSnsAccounts).where(xAccount(wikiId));
  return { x: { available, account: row ? toAccount(row) : null } };
}

/** 連携し直しが要る（X がトークンを受け付けない・更新用のトークンが無い・復号できない）。 */
const reauthRequired = () => new HttpError(409, "x_reauth_required", "the x connection is no longer valid; connect again");

/** X の失敗を、管理画面に返すエラーに直す。 */
export function xHttpError(err: unknown): unknown {
  if (!(err instanceof XApiError)) return err;
  switch (err.kind) {
    case "unauthorized":
      return reauthRequired();
    case "forbidden":
      return new HttpError(422, "x_rejected", "x rejected the request", { detail: err.detail });
    case "rate_limited":
      return new HttpError(429, "x_rate_limited", "x rate limit exceeded");
    case "payment_required":
      return new HttpError(422, "x_payment_required", "x requires payment; the developer app has no api credits left");
    case "unavailable":
      return new HttpError(502, "x_unavailable", "could not reach x");
  }
}

/**
 * X の認可から戻ってきたコードで、アカウントをつなぐ。すでにつないであれば、新しいアカウントとトークンで置き換える（連携し直し）。
 * X への問い合わせ（コードの交換・アカウントの確認）を済ませてから、行と監査ログを同じトランザクションで書く。
 */
export async function connectX(db: Db, x: XDeps, wiki: Wiki, actor: AuditActor, grant: { code: string; codeVerifier: string }): Promise<SnsAccount> {
  const tokens = await x.client.exchangeCode(grant);
  const user = await x.client.me(tokens.accessToken);
  const context = tokenContext(wiki.id);
  const values = {
    externalId: user.id,
    username: user.username,
    displayName: user.name,
    accessTokenEnc: await encryptToken(x.tokenKey, tokens.accessToken, context),
    refreshTokenEnc: tokens.refreshToken ? await encryptToken(x.tokenKey, tokens.refreshToken, context) : null,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    connectedBy: actorUserId(actor),
    connectedByLabel: actor.label,
  };
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(wikiSnsAccounts)
      .values({ wikiId: wiki.id, provider: "x", ...values })
      .onConflictDoUpdate({ target: [wikiSnsAccounts.wikiId, wikiSnsAccounts.provider], set: { ...values, connectedAt: now, updatedAt: now } })
      .returning();
    await writeAudit(tx, {
      wikiId: wiki.id,
      actor,
      action: "sns_connect",
      target: { type: "wiki", id: wiki.id, label: wiki.name },
      detail: { provider: "x", username: user.username },
    });
    return toAccount(row!);
  });
}

/**
 * 連携を外す。行を消し、監査ログに残す。X の側のトークンも無効にするが、X に届かなくても解除は済ませる
 * （行が無ければこの wiki からはポストできない。X の側の許可は、X の設定の「連携しているアプリ」からも外せる）。
 * `x` が null（X 連携の設定を外した環境）でも、行は消せる。
 */
export async function disconnectX(db: Db, x: XDeps | null, wiki: Wiki, actor: AuditActor): Promise<void> {
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx.delete(wikiSnsAccounts).where(xAccount(wiki.id)).returning();
    if (!row) return null;
    await writeAudit(tx, {
      wikiId: wiki.id,
      actor,
      action: "sns_disconnect",
      target: { type: "wiki", id: wiki.id, label: wiki.name },
      detail: { provider: "x", username: row.username },
    });
    return row;
  });
  if (!removed || !x) return;
  try {
    // 更新用のトークンを無効にすると、同じ許可で出たアクセストークンも使えなくなる
    const token = await decryptToken(x.tokenKey, removed.refreshTokenEnc ?? removed.accessTokenEnc, tokenContext(wiki.id));
    if (token) await x.client.revoke(token);
  } catch (err) {
    if (!(err instanceof XApiError)) throw err;
    console.warn(`x token revoke failed: ${err.kind}`);
  }
}

/**
 * いま使えるアクセストークンを返す。期限が近ければ、更新用のトークンで取り直して保存する。
 * X の更新用のトークンは1回きりで、使うと新しいものに置き換わる。2つのリクエストが同時に更新すると片方が古いトークンを使って
 * 連携が切れるので、行をロックしたまま X に問い合わせ、新しいトークンを同じトランザクションで保存する。
 */
async function freshAccessToken(db: Db, x: XDeps, wikiId: string, now: Date): Promise<{ accessToken: string; username: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(wikiSnsAccounts).where(xAccount(wikiId)).for("update");
    if (!row) throw new HttpError(409, "sns_not_connected", "no x account is connected to this wiki");
    const context = tokenContext(wikiId);
    if (row.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
      const accessToken = await decryptToken(x.tokenKey, row.accessTokenEnc, context);
      if (accessToken) return { accessToken, username: row.username };
    }
    const refreshToken = row.refreshTokenEnc && (await decryptToken(x.tokenKey, row.refreshTokenEnc, context));
    if (!refreshToken) throw reauthRequired();
    const tokens = await x.client.refresh(refreshToken);
    await tx
      .update(wikiSnsAccounts)
      .set({
        accessTokenEnc: await encryptToken(x.tokenKey, tokens.accessToken, context),
        // 新しい更新用のトークンが返らなかったら、いまのものを持ち続ける
        ...(tokens.refreshToken && { refreshTokenEnc: await encryptToken(x.tokenKey, tokens.refreshToken, context) }),
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        updatedAt: now,
      })
      .where(eq(wikiSnsAccounts.id, row.id));
    return { accessToken: tokens.accessToken, username: row.username };
  });
}

/**
 * wiki につないだ X のアカウントでポストする。記事の公開のお知らせなど、あとから足す機能もここを通す。
 * 失敗は `HttpError`（連携し直しが要る・X が受け付けない・回数の上限・X に届かない）で投げる。
 */
export async function postAsWiki(db: Db, x: XDeps, wikiId: string, text: string, now = new Date()): Promise<SnsPostResult & { username: string }> {
  try {
    const { accessToken, username } = await freshAccessToken(db, x, wikiId, now);
    const { id } = await x.client.createPost(accessToken, text);
    return { id, url: xPostUrl(username, id), username };
  } catch (err) {
    // 原因の切り分け用。種類とステータスだけを残す（トークンも本文も残さない）
    if (err instanceof XApiError) console.warn(`x post failed: ${err.kind}${err.status ? ` (${err.status})` : ""}`);
    throw xHttpError(err);
  }
}

/** 管理画面からのテスト投稿。ポストできたら監査ログに残す（文面は残さない）。 */
export async function testPostX(db: Db, x: XDeps, wiki: Wiki, actor: AuditActor, text: string): Promise<SnsPostResult> {
  const { id, url, username } = await postAsWiki(db, x, wiki.id, text);
  await writeAudit(db, {
    wikiId: wiki.id,
    actor,
    action: "sns_test_post",
    target: { type: "wiki", id: wiki.id, label: wiki.name },
    detail: { provider: "x", username, postId: id },
  });
  return { id, url };
}
