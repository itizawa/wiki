import { z } from "zod";

/**
 * 公開サイトのトップ（`/`）の設定。wiki ごとに持つ（`wikis.home`）。
 * いまは自由記述だけ。あとで出す部品の並びや表示の切り替えを足せるように、文字列ではなくオブジェクトで持つ。
 */
export type WikiHome = {
  /** 新着記事の上に出す自由記述（Markdown）。空なら何も出さない */
  introMd: string;
};

/** 自由記述の長さの上限（文字数） */
export const HOME_INTRO_MAX = 10_000;

export const DEFAULT_HOME: WikiHome = { introMd: "" };

/** 「トップページ」の保存 */
export const updateHomeInput = z.object({
  introMd: z.string().max(HOME_INTRO_MAX),
});
export type UpdateHomeInput = z.infer<typeof updateHomeInput>;

/**
 * 保存してあるトップの設定（`wikis.home`）を読む。無い・正しくない項目は既定に戻す。
 * 空白だけの自由記述は空として扱う。
 */
export function resolveHome(raw: unknown): WikiHome {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intro = typeof value.introMd === "string" && value.introMd.length <= HOME_INTRO_MAX ? value.introMd : "";
  return { introMd: intro.trim() === "" ? "" : intro };
}
