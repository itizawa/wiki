import { type RatingSummary, summarizeRatings } from "@wiki/shared";

/** 読者の ID を覚えておく localStorage のキー。どの wiki でも同じ ID を使う（wiki はサブドメインごとに別のオリジンなので、実際は wiki ごと） */
export const RATER_KEY = "wiki.raterId";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * 読者の ID（評価を付け直したときに、同じ人の1件として上書きするため）。
 * localStorage に無ければ作って覚える。localStorage が使えない（プライベートブラウズなど）ときは、そのページを開いている間だけの ID になる。
 */
export function raterId(storage: StorageLike | undefined, newId: () => string): string {
  try {
    const saved = storage?.getItem(RATER_KEY);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const id = newId();
    storage?.setItem(RATER_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

export const ratingUrl = (pageId: string) => `/api/ratings/${pageId}`;

/** いまの評価。評価を使っていない wiki・ページ（404）と、取れなかったときは null（評価の欄を出さない） */
export async function fetchRating(fetchImpl: typeof fetch, pageId: string, rater: string): Promise<RatingSummary | null> {
  try {
    const res = await fetchImpl(`${ratingUrl(pageId)}?rater=${encodeURIComponent(rater)}`, { headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as RatingSummary) : null;
  } catch {
    return null;
  }
}

/**
 * 星を付けた直後に出す、見込みの評価（楽観的更新）。送った結果を待たずに、自分の星・件数・平均を先に変える。
 * 付け直しなら前の星の件数を1つ減らし、新しい星を1つ増やす。サーバーの返事が来たら、そちらで置き換える。
 */
export function applyRating(summary: RatingSummary, score: number): RatingSummary {
  const counts = summary.counts.map((n, i) => {
    const star = i + 1;
    return n - (star === summary.mine && n > 0 ? 1 : 0) + (star === score ? 1 : 0);
  }) as RatingSummary["counts"];
  return summarizeRatings(counts, score);
}

export type RateResult = { ok: true; summary: RatingSummary } | { ok: false; message: string };

/** 星を付ける・付け直す */
export async function sendRating(fetchImpl: typeof fetch, pageId: string, rater: string, score: number): Promise<RateResult> {
  try {
    const res = await fetchImpl(ratingUrl(pageId), {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ score, raterId: rater }),
    });
    if (res.ok) return { ok: true, summary: (await res.json()) as RatingSummary };
    if (res.status === 429) return { ok: false, message: "評価が続いたため、少し待ってからもう一度お試しください" };
    return { ok: false, message: "評価を送れませんでした" };
  } catch {
    return { ok: false, message: "評価を送れませんでした" };
  }
}
