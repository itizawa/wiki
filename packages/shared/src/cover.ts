import { z } from "zod";
import { isBackgroundImagePath } from "./theme";

/**
 * ページのカバー画像（タイトルの上に出す横長の画像）。
 * 値は画像のパスで、次のどちらか。
 * - アップロードした画像：`/images/{24文字}.(png|jpg|webp)`。GIF は動くので使えない
 * - 用意した画像：`/covers/{key}.svg`（`COVER_PRESETS` のもの）
 * 管理画面と公開サイトは、同じパスで見える（どちらも自分の `public/covers/` に同じファイルを持つ。cover.test.ts が揃っていることを確かめる）。
 */
export type CoverPreset = {
  key: string;
  /** 管理画面のギャラリーに出す名前（画像の説明にも使う） */
  name: string;
};

/** 用意したカバー画像。自作の SVG（`apps/{admin,site}/public/covers/{key}.svg`）。順番がギャラリーの並び */
export const COVER_PRESETS: readonly CoverPreset[] = [
  { key: "sunrise", name: "朝焼け" },
  { key: "forest", name: "森" },
  { key: "ocean", name: "海" },
  { key: "dusk", name: "夕暮れ" },
  { key: "mountains", name: "山並み" },
  { key: "night", name: "星空" },
  { key: "meadow", name: "草原" },
  { key: "blossom", name: "桜" },
];

/** 用意した画像1枚のパス */
export function coverPresetPath(key: string): string {
  return `/covers/${key}.svg`;
}

const PRESET_PATH = /^\/covers\/([a-z]+)\.svg$/;

/** パスが指す、用意した画像。用意した画像でなければ null */
export function findCoverPreset(path: string): CoverPreset | null {
  const key = PRESET_PATH.exec(path)?.[1];
  return COVER_PRESETS.find((p) => p.key === key) ?? null;
}

/** カバーとして使えるパスか（アップロードした PNG・JPEG・WebP か、用意した画像） */
export function isPageCoverPath(value: string): boolean {
  return isBackgroundImagePath(value) || findCoverPreset(value) !== null;
}

/** カバーに使えるアップロード画像の条件。本文の画像と同じ上限（5MB）で、GIF だけ除く */
export const COVER_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const COVER_UPLOAD_LIMIT_LABEL = "PNG・JPEG・WebP、5MB まで";

export const pageCoverSchema = z.string().refine(isPageCoverPath, { message: "cover must be an uploaded PNG, JPEG or WebP, or one of the provided images" });

/** カバーを付ける・変える・外す（null）。 */
export const setPageCoverInput = z.object({ cover: pageCoverSchema.nullable() });
export type SetPageCoverInput = z.infer<typeof setPageCoverInput>;
