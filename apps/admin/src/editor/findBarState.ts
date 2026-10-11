// 本文の検索バーが開いているかどうか。ヘッダーのボタンやコマンドメニュー（エディタの外）からも開けるよう、部品の外に持つ。
// ここではエディタ（TipTap）を import しない。コマンドメニューは最初に読む JS に入るので、ここから辿れるものも全部そこに入る
const listeners = new Set<() => void>();
let isOpen = false;

export const isFindBarOpen = () => isOpen;

export const setFindBarOpen = (next: boolean) => {
  isOpen = next;
  listeners.forEach((l) => l());
};

export const subscribeFindBar = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** 検索バーを開く（すでに開いていれば、検索欄にフォーカスを戻す）。 */
export function openFindBar() {
  setFindBarOpen(true);
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[role="search"] input')?.focus());
}
