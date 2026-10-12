import { useEffect } from "react";

/** ファビコンを設定していないとき（と wiki の外の画面）のタブのアイコン。`index.html` に書いたものと同じ。 */
export const DEFAULT_TAB_ICON = { href: "/favicon.svg", type: "image/svg+xml" } as const;

/** タブのアイコンの href と type。`.webp` は image/webp、それ以外は image/png（公開サイトの Base.astro と同じ決め方）。未設定は既定のアイコン。 */
export function tabIconFor(faviconUrl: string | null | undefined): { href: string; type: string } {
  if (!faviconUrl) return DEFAULT_TAB_ICON;
  return { href: faviconUrl, type: faviconUrl.endsWith(".webp") ? "image/webp" : "image/png" };
}

/**
 * 開いている間、タブのアイコン（`<link rel="icon">`）を差しかえる。
 * 閉じる（wiki の外へ出る・別の wiki に切り替える）と既定に戻してから次の値を入れるので、wiki の外の画面には残らない。
 */
export function useTabIcon(faviconUrl: string | null | undefined): void {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    const icon = tabIconFor(faviconUrl);
    link.type = icon.type;
    link.href = icon.href;
    return () => {
      link.type = DEFAULT_TAB_ICON.type;
      link.href = DEFAULT_TAB_ICON.href;
    };
  }, [faviconUrl]);
}
