import { useQueryClient } from "@tanstack/react-query";
import type { ScheduledAction } from "@wiki/shared";
import { showToast } from "../components/Toast";
import { api } from "./api";
import { formatDateTime } from "./format";

const actionName = (a: Pick<ScheduledAction, "actionType" | "targetVisibility">) =>
  a.actionType === "publish_page" ? (a.targetVisibility === "unlisted" ? "限定公開" : "公開") : a.actionType === "unpublish_page" ? "非公開化" : "マージ";

const subject = (a: Pick<ScheduledAction, "pageTitle" | "branchName" | "pageId">) => `「${a.pageTitle ?? a.branchName ?? a.pageId}」`;

/** 同じ内容で予約し直す。ブランチのマージの予約は、画面からは作れない。 */
export function reservableAgain(a: ScheduledAction): boolean {
  return a.status === "scheduled" && a.pageId !== null && (a.actionType === "unpublish_page" || (a.actionType === "publish_page" && a.versionId !== null && a.targetVisibility !== null));
}

function recreate(a: ScheduledAction) {
  if (a.actionType === "publish_page") {
    return api.createSchedule({ actionType: "publish_page", pageId: a.pageId!, versionId: a.versionId!, targetVisibility: a.targetVisibility!, runAt: a.runAt, batchId: a.batchId ?? undefined });
  }
  return api.createSchedule({ actionType: "unpublish_page", pageId: a.pageId!, runAt: a.runAt, batchId: a.batchId ?? undefined });
}

/**
 * 予約の「予約した」「取り消した」を、画面の下に知らせ、「元に戻す」を付ける。
 * 取り消しは確認を挟まず、その場で実行する（戻せるため）。
 */
export function useScheduleToasts() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["schedule"] });

  /** 取り消す。成功したら知らせる（失敗は呼び出し側のエラー表示に任せる）。 */
  const cancel = async (a: ScheduledAction) => {
    await api.cancelSchedule(a.id);
    await refresh();
    showToast({
      message: `${subject(a)}の${formatDateTime(a.runAt)}の${actionName(a)}の予約を取り消しました`,
      undo: reservableAgain(a)
        ? async () => {
            await recreate(a);
            await refresh();
            return `${subject(a)}の${actionName(a)}を ${formatDateTime(a.runAt)} に予約し直しました`;
          }
        : undefined,
    });
  };

  /** 予約したことを知らせる。「元に戻す」は、いま作った予約を取り消す。 */
  const created = (action: ScheduledAction, title: string) => {
    const a = { ...action, pageTitle: action.pageTitle ?? title };
    showToast({
      message: `${subject(a)}の${actionName(a)}を ${formatDateTime(a.runAt)} に予約しました`,
      undo: async () => {
        await api.cancelSchedule(a.id);
        await refresh();
        return `${subject(a)}の${actionName(a)}の予約を取り消しました`;
      },
    });
  };

  return { cancel, created };
}
