import type { RoutineSummary, RoutineTestResult, UpdateRoutineInput } from "@wiki/shared";
import { asc, eq } from "drizzle-orm";
import { type AuditActor, actorUserId, writeAudit } from "../audit/service";
import { decryptToken, encryptToken } from "../crypto/token";
import type { Db } from "../db/client";
import { workflowRoutines } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { isUniqueViolation } from "../tags/service";
import { fireRoutine } from "./routine";

/** Routine の登録。トークンは `ROUTINE_TOKEN_KEY`（key）で暗号化して持ち、どこにも返さない。変えるものは、呼ぶ側のトランザクション（tx）の中で呼ぶ */

type Row = typeof workflowRoutines.$inferSelect;

const summary = (r: Row): RoutineSummary => ({ id: r.id, name: r.name, url: r.url, createdAt: r.createdAt.toISOString() });
const tokenContext = (id: string) => `routine:${id}`;
const target = (r: { id: string; name: string }) => ({ type: "routine" as const, id: r.id, label: r.name });
const duplicate = (name: string) => new HttpError(409, "routine_exists", `routine ${name} already exists`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function find(db: Db, id: string): Promise<Row> {
  if (!UUID.test(id)) throw notFound(`routine ${id}`);
  const [row] = await db.select().from(workflowRoutines).where(eq(workflowRoutines.id, id));
  if (!row) throw notFound(`routine ${id}`);
  return row;
}

export async function listRoutines(db: Db): Promise<RoutineSummary[]> {
  const rows = await db.select().from(workflowRoutines).orderBy(asc(workflowRoutines.name), asc(workflowRoutines.id));
  return rows.map(summary);
}

export async function createRoutine(
  tx: Db,
  key: string,
  input: { name: string; url: string; token: string },
  actor: AuditActor,
): Promise<RoutineSummary> {
  const id = crypto.randomUUID();
  const tokenEnc = await encryptToken(key, input.token, tokenContext(id));
  const [row] = await tx
    .insert(workflowRoutines)
    .values({ id, name: input.name, url: input.url, tokenEnc, createdBy: actorUserId(actor) })
    .returning()
    .catch((err) => {
      throw isUniqueViolation(err) ? duplicate(input.name) : err;
    });
  await writeAudit(tx, { wikiId: null, actor, action: "routine_create", target: target(row!), detail: {} });
  return summary(row!);
}

export async function updateRoutine(tx: Db, key: string, id: string, input: UpdateRoutineInput, actor: AuditActor): Promise<RoutineSummary> {
  const before = await find(tx, id);
  const patch: Partial<typeof workflowRoutines.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  // 空なら変えない（入れたときだけ置き換える）
  if (input.token !== undefined) patch.tokenEnc = await encryptToken(key, input.token, tokenContext(id));
  const [row] = await tx
    .update(workflowRoutines)
    .set(patch)
    .where(eq(workflowRoutines.id, id))
    .returning()
    .catch((err) => {
      throw isUniqueViolation(err) ? duplicate(input.name ?? before.name) : err;
    });
  await writeAudit(tx, {
    wikiId: null,
    actor,
    action: "routine_update",
    target: target(row!),
    detail: {
      ...(input.name !== undefined && input.name !== before.name && { name: { from: before.name, to: input.name } }),
      ...(input.url !== undefined && input.url !== before.url && { url: true }),
      ...(input.token !== undefined && { token: true }),
    },
  });
  return summary(row!);
}

/** 消す。どこかのワークフローが使っていたら 409 にする確認は、ワークフローの定義のテーブルができたあとに足す */
export async function deleteRoutine(tx: Db, id: string, actor: AuditActor): Promise<void> {
  const row = await find(tx, id);
  await tx.delete(workflowRoutines).where(eq(workflowRoutines.id, id));
  await writeAudit(tx, { wikiId: null, actor, action: "routine_delete", target: target(row), detail: {} });
}

/** テスト実行に送る文。ページ ID などは「テスト」と明記した値で、編集リクエストを作らないよう Routine の指示に書いておく前提 */
export const ROUTINE_TEST_TEXT = [
  "これは wiki の管理画面からのテスト実行です。実際のページへの操作ではありません。",
  "ページ ID: テスト（存在しません）",
  "タグ: テスト",
  "編集リクエストは作らないでください。",
].join("\n");

/**
 * 1回呼んで、結果を返す（呼べなかった理由も、結果として返す）。結果は監査ログに残す（トークンは含めない）。
 * 呼び出しは、DB のトランザクションの外で行う（相手が遅くても、接続を握らない）。
 */
export async function testRoutine(db: Db, key: string, id: string, actor: AuditActor, fetchImpl?: typeof fetch): Promise<RoutineTestResult> {
  const row = await find(db, id);
  const token = await decryptToken(key, row.tokenEnc, tokenContext(id));
  if (token === null) {
    throw new HttpError(409, "routine_token_unreadable", "the token cannot be decrypted; set it again (ROUTINE_TOKEN_KEY may have changed)");
  }
  const result = await fireRoutine({ url: row.url, token, text: ROUTINE_TEST_TEXT }, fetchImpl);
  await writeAudit(db, {
    wikiId: null,
    actor,
    action: "routine_test",
    target: target(row),
    detail: result.ok ? { ok: true } : { ok: false, reason: result.reason },
  });
  return result;
}
