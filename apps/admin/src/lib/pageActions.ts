import { useSyncExternalStore } from "react";

/** いま開いている編集画面でできる操作。編集画面の外（コマンドメニュー）から呼ぶために預かる。 */
export type PageActions = { copyMarkdown: () => void; downloadMarkdown: () => void; keepVersion: () => void };

const listeners = new Set<() => void>();
let current: PageActions | null = null;

/** 編集画面を開いている間だけ操作を預け、離れたら null に戻す。 */
export function setPageActions(next: PageActions | null) {
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** 編集画面を開いていなければ null。 */
export const usePageActions = () => useSyncExternalStore(subscribe, () => current);
