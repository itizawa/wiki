import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * 通知の、画面をまたいで使うもの（クエリのキーと、未読の数）。
 * 既読にしたあとは `notificationKeys.all()` をまとめて読み直す（一覧と未読の数）。
 */
export const notificationKeys = {
  all: () => ["notifications"] as const,
  list: () => ["notifications", "list"] as const,
  count: () => ["notifications", "count"] as const,
};

/** 未読の数を取り直す間隔（ミリ秒）。ワークフローの実行が終わった知らせは、この間隔で追いつく */
export const UNREAD_NOTIFICATION_COUNT_INTERVAL = 60_000;

/** 開いている wiki の、自分宛ての未読の数。読み込み中と失敗のあいだは undefined（件数なしで出す） */
export function useUnreadNotificationCount(): number | undefined {
  return useQuery({
    queryKey: notificationKeys.count(),
    queryFn: api.countUnreadNotifications,
    refetchInterval: UNREAD_NOTIFICATION_COUNT_INTERVAL,
    refetchOnWindowFocus: true,
  }).data?.unread;
}

/** ベルのボタンの名前（読み上げとツールチップ）。数字だけでは何の数か分からないので、言葉で添える */
export function bellLabel(unread: number | undefined): string {
  return unread ? `通知（未読 ${unread > 99 ? "99 件以上" : `${unread} 件`}）` : "通知";
}
