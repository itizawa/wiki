/** 「…」メニューの「共有」と「URLをコピー」（SiteMenu.tsx）。ブラウザの API を引数で受け、テストできるようにしてある */

type ShareData = { title?: string; url?: string };
export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/** Web Share API が使えるか。使えない環境では、メニューに「共有」を出さない */
export function canShare(nav: ShareNavigator | undefined): boolean {
  return typeof nav?.share === "function";
}

export type ShareResult = "shared" | "cancelled" | "failed";

/** 共有シートを開く。使う人が閉じた（AbortError）ときは、失敗にしない */
export async function sharePage(nav: ShareNavigator, data: { title: string; url: string }): Promise<ShareResult> {
  if (!nav.share) return "failed";
  try {
    await nav.share(data);
    return "shared";
  } catch (e) {
    return e instanceof Error && e.name === "AbortError" ? "cancelled" : "failed";
  }
}

/** URL をクリップボードに入れる。http や古いブラウザなど、使えない環境では false */
export async function copyUrl(nav: ShareNavigator, url: string): Promise<boolean> {
  if (!nav.clipboard) return false;
  try {
    await nav.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
