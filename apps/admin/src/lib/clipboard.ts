/** コピーに失敗したときに出す注意。 */
export const COPY_FAILED_MESSAGE = "コピーできませんでした。ブラウザでクリップボードの利用を許可してください";

/**
 * クリップボードへ文字列をコピーする。
 * 書けたら onCopied、できなければ（クリップボードが使えない・拒否された）onFail を呼ぶ。
 * クリップボードが無い場合と writeText が同期で投げた場合は、await の手前で同期的に onFail を呼ぶ。
 * writeText が reject した場合と、成功の場合は、await の後に呼ぶ。
 */
export async function copyText(text: string, onCopied: () => void, onFail: () => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    onCopied();
  } catch {
    onFail();
  }
}
