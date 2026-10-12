import { IMAGE_LIMIT_LABEL, IMAGE_MAX_BYTES, IMAGE_TYPES } from "@wiki/shared";

/** アップロードできる画像の条件：形式・大きさの上限・画面に出す説明 */
export type ImageRule = { types: readonly string[]; maxBytes: number; limitLabel: string };

/** 本文や wiki の画像の条件 */
export const DEFAULT_IMAGE_RULE: ImageRule = { types: Object.keys(IMAGE_TYPES), maxBytes: IMAGE_MAX_BYTES, limitLabel: IMAGE_LIMIT_LABEL };

/**
 * アップロードする前に、画面の側で分かる理由（形式・大きさ）で断る。断るときはその理由、受け付けるなら null。
 * 最終的な判定はサーバーが中身を見て行う。条件（`rule`）を省くと、本文の画像の条件。
 * エディタの外（wiki の画像を選ぶ欄）も使うので、エディタ（TipTap）を import する imageUpload.ts とは分けて置く。
 */
export function imageFileProblem(file: { type: string; size: number }, rule: ImageRule = DEFAULT_IMAGE_RULE): string | null {
  if (!rule.types.includes(file.type)) return `この形式のファイルはアップロードできません。${rule.limitLabel}です。`;
  if (file.size > rule.maxBytes) return `画像が大きすぎます。${rule.limitLabel}です。`;
  return null;
}
