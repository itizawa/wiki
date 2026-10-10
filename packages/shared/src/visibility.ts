import type { Visibility } from "./page";

/**
 * 公開範囲の広さ。親子の決まり（配下のページは、親と同じか、より狭い公開範囲だけ）に使う。
 * GROWI の閲覧権限に合わせる：公開 > リンクを知っている人のみ（限定公開） > 自分のみ（非公開）。
 */
const RANK: Record<Visibility, number> = { private: 0, unlisted: 1, public: 2 };

/** 最上位のページの「親」の公開範囲。最上位はどれでも選べる。 */
export const TOP_LEVEL_BOUND: Visibility = "public";

/** child が parent と同じか、より狭いか。parent が null なら最上位（どれでも可）。 */
export function isWithinParent(child: Visibility, parent: Visibility | null): boolean {
  return RANK[child] <= RANK[parent ?? TOP_LEVEL_BOUND];
}

/** a が b より広いか。 */
export function isWider(a: Visibility, b: Visibility): boolean {
  return RANK[a] > RANK[b];
}
