import { DEFAULT_THEME } from "@wiki/shared";
import { useEffect, useSyncExternalStore } from "react";

/**
 * 管理画面の配色に使う、wiki の外観のテーマの key。wiki の画面を開いている間だけ、その wiki のテーマになる（wiki の外の画面は既定）。
 * 配色は画面全体（メニューやダイアログも）に効くので、画面の外側の ThemeProvider（main.tsx）がこれを読んで MUI のテーマを差しかえる。
 */

const STORAGE_KEY = "wiki.admin.themePresets";

/** wiki の key ごとに、最後に開いたときのテーマの key を覚えておく。次に開くとき、wiki の一覧が届く前から同じ配色で出し、色が切り替わるのを見せないため */
function readRemembered(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function remember(wikiKey: string, preset: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readRemembered(), [wikiKey]: preset }));
  } catch {
    // 保存できなくても表示は続ける
  }
}

/** `/w/{key}/...` の key。wiki の外の画面なら null */
export function wikiKeyFromPath(pathname: string): string | null {
  return /^\/w\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

let current: string = (() => {
  const key = typeof location === "undefined" ? null : wikiKeyFromPath(location.pathname);
  return (key && readRemembered()[key]) || DEFAULT_THEME.preset;
})();
const listeners = new Set<() => void>();

function set(preset: string) {
  if (preset === current) return;
  current = preset;
  for (const l of listeners) l();
}

/** 管理画面の配色にいま使うテーマの key */
export function useAdminThemePreset(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * 開いている wiki のテーマを、管理画面の配色にする。`preset` は wiki の一覧が届くまで undefined（その間は、最後に覚えたものを使う）。
 * wiki の画面を離れる（外へ出る・別の wiki に切り替える）と既定に戻してから次の値を入れるので、wiki の外の画面には残らない。
 */
export function useAdminThemeFor(wikiKey: string, preset: string | undefined): void {
  useEffect(() => {
    const next = preset ?? readRemembered()[wikiKey] ?? DEFAULT_THEME.preset;
    if (preset) remember(wikiKey, preset);
    set(next);
    return () => set(DEFAULT_THEME.preset);
  }, [wikiKey, preset]);
}
