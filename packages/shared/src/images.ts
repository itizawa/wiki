/**
 * アップロードした画像。保存先（Cloudflare R2）の名前はランダムで、`/images/{name}` で配る。
 * 管理画面と公開サイトのどちらのオリジンでも同じパスで見られるので、本文には相対パスで書く。
 * 認証はしない（非公開・限定公開のページに貼った画像も、URL を知っていれば見られる）。
 */

/** 1枚の上限（バイト） */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 受け付ける形式と拡張子。SVG はスクリプトを含められるので受け付けない */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

/** 画面に出す上限の説明 */
export const IMAGE_LIMIT_LABEL = "PNG・JPEG・WebP・GIF、5MB まで";

/**
 * 画像の名前（ランダムな24文字＋拡張子）の正規表現。前後の区切りは付けていない。
 * 本文などの文字列の中から名前を拾うとき（参照されていない画像の掃除）にも、同じ形を使う
 */
export const IMAGE_NAME_PATTERN = "[0-9a-z]{24}\\.(?:png|jpg|webp|gif)";

/** 本文に書く画像のパス */
const IMAGE_PATH = new RegExp(`^/images/(${IMAGE_NAME_PATTERN})$`);

/** `/images/{name}` なら name を返す。 */
export function imageNameFromPath(path: string): string | null {
  return IMAGE_PATH.exec(path)?.[1] ?? null;
}

/** 名前（拡張子）から形式を返す。 */
export function imageTypeOfName(name: string): ImageType | null {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const found = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext);
  return found ? (found[0] as ImageType) : null;
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/**
 * 中身の先頭から形式を判定する（送られてきた Content-Type やファイル名は信じない）。
 * 受け付けない形式なら null。
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** 新しい画像の名前。推測できないよう、ランダムな24文字（約124bit）にする */
export function newImageName(type: ImageType): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let id = "";
  for (const b of bytes) id += alphabet[b % 36];
  return `${id}.${IMAGE_TYPES[type]}`;
}
