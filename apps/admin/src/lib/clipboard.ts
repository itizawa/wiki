/** コピーに失敗したときに出す注意。 */
export const COPY_FAILED_MESSAGE = "コピーできませんでした。ブラウザでクリップボードの利用を許可してください";

/** クリップボードへ文字列をコピーする。コピーできたら true、できなければ（クリップボードが使えない・拒否された）false。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
