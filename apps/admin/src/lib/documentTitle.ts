import { useContext, useEffect } from "react";
import { UNTITLED_TITLE } from "./untitled";
import { WikiContext } from "./wiki";

/** wiki の外の画面（と題を決めていない画面）のタブの題。`index.html` に書いたものと同じ。 */
export const DEFAULT_DOCUMENT_TITLE = "wiki 管理画面";

/** タブの題。「画面の名前 | wiki の名前」（公開サイトの `ページ名 | サイト名` と同じ並び）。wiki の外では、wiki の名前のかわりに「wiki 管理画面」。 */
export function documentTitle(screen: string, wikiName?: string | null): string {
  const name = screen.trim() || UNTITLED_TITLE;
  return `${name} | ${wikiName || DEFAULT_DOCUMENT_TITLE}`;
}

/**
 * 開いている間、タブの題（`document.title`）を `title` にする。`null` のあいだ（読み込み中など）は触らない。
 * 閉じる（別の画面へ移る）と、開く前の題に戻す。入力中のタイトルに追従させるときも、値が変わるたびに戻してから入れ直すので残らない。
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}

/**
 * 画面の名前をタブの題にする（「画面の名前 | wiki の名前」）。wiki の画面の中では、いまの wiki の名前が付く。
 * `screen` が `null` のあいだ（ページを読み込む前など）は触らない。
 */
export function useScreenTitle(screen: string | null): void {
  const wiki = useContext(WikiContext)?.wiki;
  useDocumentTitle(screen === null ? null : documentTitle(screen, wiki?.name));
}
