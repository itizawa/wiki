import { useCallback, useSyncExternalStore } from "react";

const KEY = "wiki.stars";
const listeners = new Set<() => void>();
let cache: { raw: string | null; ids: string[] } | null = null;

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // 読めない環境では、スター無しとして動く
  }
  if (cache && cache.raw === raw) return cache.ids;
  let ids: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // 壊れた値は捨てる
  }
  cache = { raw, ids };
  return ids;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // 別のタブで変えたときも追従する
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** スターの付け外し。付けたものは末尾に足す。 */
export function toggleStar(ids: readonly string[], pageId: string): string[] {
  return ids.includes(pageId) ? ids.filter((id) => id !== pageId) : [...ids, pageId];
}

/**
 * スターを付けたページ（よく開くページの目印）。このブラウザだけに覚えさせる、自分用のもの。
 * サイドバーと編集画面の両方から使い、どちらで変えてもすぐ揃う。
 */
export function useStars(): { ids: string[]; toggle: (pageId: string) => void } {
  const ids = useSyncExternalStore(subscribe, read);
  const toggle = useCallback((pageId: string) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(toggleStar(read(), pageId)));
    } catch {
      return;
    }
    listeners.forEach((l) => l());
  }, []);
  return { ids, toggle };
}
