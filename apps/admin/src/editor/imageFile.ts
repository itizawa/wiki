import { IMAGE_LIMIT_LABEL, IMAGE_MAX_BYTES, IMAGE_TYPES } from "@wiki/shared";

/**
 * アップロードする前に、画面の側で分かる理由（形式・大きさ）で断る。断るときはその理由、受け付けるなら null。
 * 最終的な判定はサーバーが中身を見て行う。
 * エディタの外（wiki の画像を選ぶ欄）も使うので、エディタ（TipTap）を import する imageUpload.ts とは分けて置く。
 */
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!(file.type in IMAGE_TYPES)) return `この形式のファイルはアップロードできません。${IMAGE_LIMIT_LABEL}です。`;
  if (file.size > IMAGE_MAX_BYTES) return `画像が大きすぎます。${IMAGE_LIMIT_LABEL}です。`;
  return null;
}
