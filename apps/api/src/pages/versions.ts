import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pageDrafts, pageLinks, pages, pageSearch, pageVersions, wikis } from "../db/schema";

type PageRow = typeof pages.$inferSelect;
type VersionRow = typeof pageVersions.$inferSelect;

/** 最後の自動保存からこれだけたった下書きは、編集が一段落したとみなして版にする */
export const DRAFT_IDLE_MS = 5 * 60_000;
/** 下書きを始めてからこれだけたったら、打ち続けているあいだでも版にする */
export const DRAFT_MAX_AGE_MS = 30 * 60_000;
/** ワーカーの1回で版にする下書きの上限。残りは次の回に回す */
export const PROMOTE_BATCH_SIZE = 100;

/** 版のタイトルの長さ（`savePageInput` と同じ） */
const MAX_TITLE_LENGTH = 200;

export const ownDraft = (pageId: string, userId: string) => and(eq(pageDrafts.pageId, pageId), eq(pageDrafts.userId, userId));

/** 本文中の `/p/{id}` 形式の内部リンクを抽出する。 */
export function extractPageLinks(bodyMd: string): string[] {
  const ids = new Set<string>();
  for (const m of bodyMd.matchAll(/\/p\/([0-9a-z]{10})(?![0-9a-z])/g)) ids.add(m[1]!);
  return [...ids];
}

/** 別の wiki のページへのリンクは外部リンクと同じ扱いにし、ここには残さない。 */
export async function replaceLinks(db: Db, wikiId: string, pageId: string, bodyMd: string) {
  await db.delete(pageLinks).where(eq(pageLinks.fromPageId, pageId));
  const linked = extractPageLinks(bodyMd).filter((id) => id !== pageId);
  const foreign = new Set(
    linked.length === 0
      ? []
      : (await db.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, linked), ne(pages.wikiId, wikiId)))).map((p) => p.id),
  );
  const targets = linked.filter((id) => !foreign.has(id));
  if (targets.length > 0) {
    await db.insert(pageLinks).values(targets.map((toPageId) => ({ fromPageId: pageId, toPageId })));
  }
}

/**
 * 検索用の写し（`page_search`）を、head 版のタイトルと本文に合わせる。
 * **head 版を進めたら、同じトランザクションで必ず呼ぶ**（呼び忘れると、検索が前の本文を探し続ける）。
 * `createPage` と `createVersion` が呼んでいるので、ふつうはこの2つを通せば足りる。
 */
export async function syncPageSearch(tx: Db, pageId: string, head: { title: string; bodyMd: string }): Promise<void> {
  const values = { title: head.title, bodyMd: head.bodyMd };
  await tx.insert(pageSearch).values({ pageId, ...values }).onConflictDoUpdate({ target: pageSearch.pageId, set: values });
}

/**
 * head が「この人の下書きから、ワーカーが自動で作った版」で、その下書きが `baseVersionId` をもとにしていたか。
 * 開いたままの画面は、ワーカーが版を作ったことを知らずに古い `baseVersionId` を送ってくる。
 * 中身は自分の続きなので、別の画面で先に保存された扱い（409）にはしない。
 */
export const isOwnAutoVersion = (head: VersionRow, userId: string, baseVersionId: string) =>
  !head.keep && head.createdBy === userId && head.baseVersionId === baseVersionId;

/**
 * いまの head の次の版を作る。版を足す、`pages` の title / head_version_id / updated_at を進める、
 * 検索用の写しを合わせる、内部リンクを作り直す、下書きを消す、までを行う。トランザクション内で、ページを行ロックしてから呼ぶ。
 * 内容が head と同じなら版は作らない。そのとき `keep` が true で head が間引ける版なら、head を残す版にする
 * （自動でできた版の上で、人が「版として残す」を選んだ）。
 */
export async function createVersion(
  tx: Db,
  page: PageRow,
  content: { title: string; bodyMd: string },
  opts: {
    /** 間引かずに残す版か。人が操作して作るなら true、ワーカーが作るなら false */
    keep: boolean;
    /** 作った人（ユーザーの ID）。外部のアプリ（MCP）からなら、許可した人 */
    createdBy: string | null;
    oauthGrantId?: string;
    /** 版になったら要らなくなる下書きの持ち主（ユーザーの ID） */
    draftOwner?: string;
  },
): Promise<{ versionId: string; created: boolean }> {
  // 版になったら、その人の下書きは要らない（変更が無く版を作らないときも、下書きは head と同じなので消す）
  if (opts.draftOwner) await tx.delete(pageDrafts).where(ownDraft(page.id, opts.draftOwner));
  const [head] = await tx.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
  if (head!.title === content.title && head!.bodyMd === content.bodyMd) {
    if (opts.keep && !head!.keep) await tx.update(pageVersions).set({ keep: true }).where(eq(pageVersions.id, head!.id));
    return { versionId: head!.id, created: false };
  }

  const [version] = await tx
    .insert(pageVersions)
    .values({
      pageId: page.id,
      baseVersionId: page.headVersionId,
      title: content.title,
      bodyMd: content.bodyMd,
      authorType: "human",
      createdBy: opts.createdBy,
      keep: opts.keep,
      oauthGrantId: opts.oauthGrantId ?? null,
    })
    .returning();
  await tx
    .update(pages)
    .set({ title: content.title, headVersionId: version!.id, updatedAt: new Date() })
    .where(eq(pages.id, page.id));
  await syncPageSearch(tx, page.id, content);
  await replaceLinks(tx, page.wikiId, page.id, content.bodyMd);
  return { versionId: version!.id, created: true };
}

/** 公開・予約に使った版は、間引かずに残す。 */
export async function keepVersion(db: Db, versionId: string): Promise<void> {
  await db
    .update(pageVersions)
    .set({ keep: true })
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.keep, false)));
}

/**
 * 版にできる下書きの条件（時刻を除く）。`page_drafts` に `pages` と `wikis` を結合した問い合わせで使う。
 * ワーカーに返す「次に版にできる時刻」（`cron/tick.ts`）も同じ条件で数える。
 */
export const promotableDraft = () =>
  and(
    isNull(pages.deletedAt),
    isNull(wikis.archivedAt),
    eq(pageDrafts.baseVersionId, pages.headVersionId),
    sql`btrim(${pageDrafts.title}) <> ''`,
  );

export type PromoteDraftsResult = {
  /** 版にしたページの ID */
  promoted: string[];
  /** 対象に見えたが、この回は版にしなかった下書きの数（待っているあいだに打ち直された、など） */
  skipped: number;
  failed: { pageId: string; error: string }[];
};

/** 一段落した（か、始めてから長い）下書きか。 */
const isDue = (draft: { createdAt: Date; updatedAt: Date }, now: Date) =>
  draft.updatedAt.getTime() < now.getTime() - DRAFT_IDLE_MS || draft.createdAt.getTime() < now.getTime() - DRAFT_MAX_AGE_MS;

/**
 * 編集が一段落した下書きを版にする（Cron のワーカーが `/internal/tick` で呼ぶ）。
 * 版にするのは、ページが削除されておらず、wiki がアーカイブ中でなく、下書きがいまの head をもとにしていて、タイトルが空でないものだけ。
 * 当てはまらない下書きは、消さずに残す（古い版をもとにした下書きを勝手に版にすると、あいだにできた版の変更を黙って上書きしてしまう）。
 * 下書きごとに1トランザクションで、1件の失敗はほかを止めない。
 */
export async function promoteDrafts(db: Db, now = new Date()): Promise<PromoteDraftsResult> {
  // 版にできない下書き（古い版をもとにしたもの、タイトルが空のもの）が上限を埋めないよう、ここで外しておく
  const candidates = await db
    .select({ pageId: pageDrafts.pageId, userId: pageDrafts.userId })
    .from(pageDrafts)
    .innerJoin(pages, eq(pages.id, pageDrafts.pageId))
    .innerJoin(wikis, eq(wikis.id, pages.wikiId))
    .where(
      and(
        or(lt(pageDrafts.updatedAt, new Date(now.getTime() - DRAFT_IDLE_MS)), lt(pageDrafts.createdAt, new Date(now.getTime() - DRAFT_MAX_AGE_MS))),
        promotableDraft(),
      ),
    )
    .orderBy(asc(pageDrafts.updatedAt))
    .limit(PROMOTE_BATCH_SIZE);

  const result: PromoteDraftsResult = { promoted: [], skipped: 0, failed: [] };
  for (const c of candidates) {
    try {
      const promoted = await db.transaction(async (tx) => {
        // 下書きの保存（PUT /pages/:id/draft）と同じく、ページの行をロックしてから下書きを読み直す
        const [page] = await tx.select().from(pages).where(eq(pages.id, c.pageId)).for("update");
        if (!page || page.deletedAt) return false;
        const [wiki] = await tx.select({ archivedAt: wikis.archivedAt }).from(wikis).where(eq(wikis.id, page.wikiId));
        if (!wiki || wiki.archivedAt) return false;
        const [draft] = await tx.select().from(pageDrafts).where(ownDraft(c.pageId, c.userId));
        // 待っているあいだに打ち直された・版になった・破棄された
        if (!draft || !isDue(draft, now)) return false;
        if (draft.baseVersionId !== page.headVersionId) return false;
        const title = draft.title.trim();
        if (title === "" || title.length > MAX_TITLE_LENGTH) return false;
        const { created } = await createVersion(
          tx,
          page,
          { title, bodyMd: draft.bodyMd },
          { keep: false, createdBy: draft.userId, draftOwner: draft.userId },
        );
        return created;
      });
      if (promoted) result.promoted.push(c.pageId);
      else result.skipped++;
    } catch (err) {
      result.failed.push({ pageId: c.pageId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
