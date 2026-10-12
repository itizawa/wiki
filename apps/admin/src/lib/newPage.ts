/**
 * 作った直後のページの印。
 * 編集画面は、この印があるページを開いたときだけ、タイトルにフォーカスして全部選ぶ（「無題」をそのまま上書きして打てる）。
 * 印は画面の中（メモリ）にだけ持つ。URL や履歴に残さないので、再読み込みやブラウザの「戻る」では付かない。
 */
const justCreated = new Set<string>();

/** ページを作って、その編集画面へ移る直前に呼ぶ。 */
export function markJustCreated(pageId: string): void {
  justCreated.add(pageId);
}

/** 作った直後なら true を返し、印を外す（一度だけ true になる）。 */
export function takeJustCreated(pageId: string): boolean {
  return justCreated.delete(pageId);
}
