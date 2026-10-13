/**
 * 記事がプレゼンモードにできるか（スライドが2枚以上になるか）を、記事のスクリプト（Article.astro）とヘッダーのメニュー（SiteMenu.tsx）で受け渡す。
 * どちらが先に動いても合うよう、状態は html の属性に持ち、変わったらイベントを投げる。
 */
export const PRESENTABLE_ATTR = "data-presentable";
export const PRESENTABLE_EVENT = "site:presentable";
/** メニューの「プレゼンモードで表示」を押したとき、メニューが投げる。記事のスクリプトが受けて開く */
export const PRESENT_EVENT = "site:present";
/** ヘッダーの「…」ボタン。プレゼンモードを閉じたあとのフォーカスの戻り先 */
export const MENU_BUTTON_ATTR = "data-site-menu-button";
