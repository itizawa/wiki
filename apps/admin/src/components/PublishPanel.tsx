import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isoToJstLocal, jstLocalToIso, pagePath, unlistedPath, type PageDetail, type PublishVisibility, type ScheduledAction } from "@wiki/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";

const statusLabel: Record<ScheduledAction["status"], string> = {
  scheduled: "予約中",
  running: "実行中",
  done: "実行済み",
  failed: "失敗",
  canceled: "キャンセル",
};

export const actionLabel = (a: Pick<ScheduledAction, "actionType" | "targetVisibility">) =>
  a.actionType === "publish_page"
    ? a.targetVisibility === "unlisted"
      ? "限定公開"
      : "公開"
    : a.actionType === "unpublish_page"
      ? "非公開化"
      : "マージ";

/** エディタ横の公開設定：公開/非公開化、限定公開URL、予約。 */
export function PublishPanel({ page, dirty }: { page: PageDetail; dirty: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: Infinity });
  const schedule = useQuery({ queryKey: ["schedule", page.id], queryFn: () => api.listSchedule({ pageId: page.id }) });
  const [visibility, setVisibility] = useState<PublishVisibility>(page.visibility === "unlisted" ? "unlisted" : "public");
  const [runAt, setRunAt] = useState(() => isoToJstLocal(new Date(Date.now() + 24 * 3600_000).toISOString()).slice(0, 11) + "07:00");
  const [scheduleKind, setScheduleKind] = useState<"publish_page" | "unpublish_page">("publish_page");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["page", page.id] });
    await qc.invalidateQueries({ queryKey: ["schedule"] });
    await qc.invalidateQueries({ queryKey: ["pages"] });
  };
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });

  const published = page.publishedVersionId !== null && page.visibility !== "private";
  const origin = settings.data?.siteOrigin ?? "";
  const url =
    page.visibility === "public"
      ? origin + pagePath(page.id, page.slug)
      : page.visibility === "unlisted" && page.unlistedKey
        ? origin + unlistedPath(page.unlistedKey)
        : null;
  const pending = (schedule.data?.actions ?? []).filter((a) => a.status === "scheduled" || a.status === "failed" || a.status === "running");

  return (
    <section className="card stack">
      <h3>公開</h3>
      <div className="small">
        {!published && <span className="badge private">非公開</span>}
        {published && page.visibility === "public" && <span className="badge public">公開中</span>}
        {published && page.visibility === "unlisted" && <span className="badge unlisted">限定公開中</span>}
        {published && page.publishedVersionId !== page.headVersionId && (
          <p className="muted">公開版より新しい編集があります。反映するにはもう一度公開してください。</p>
        )}
        {published && url && (
          <p className="mono break">
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          </p>
        )}
        {published && page.visibility === "unlisted" && (
          <p className="warn">このページはURLを知る人が閲覧できます。機密情報は載せないでください。</p>
        )}
        {published && <p className="muted">サイトへの反映は数分後（ビルド後）です。</p>}
      </div>

      <div className="row">
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as PublishVisibility)}>
          <option value="public">公開</option>
          <option value="unlisted">限定公開（URLを知る人のみ）</option>
        </select>
        <button
          className="button primary"
          disabled={dirty || action.isPending}
          title={dirty ? "先に保存してください" : undefined}
          onClick={() => action.mutate(() => api.publish(page.id, { versionId: page.headVersionId, visibility }))}
        >
          {published ? "最新版で公開し直す" : "今すぐ公開"}
        </button>
      </div>
      <div className="row">
        {published && (
          <button
            className="button"
            disabled={action.isPending}
            onClick={() => confirm("非公開にしますか？") && action.mutate(() => api.unpublish(page.id))}
          >
            非公開にする
          </button>
        )}
        {page.visibility === "unlisted" && published && (
          <button
            className="button"
            disabled={action.isPending}
            onClick={() =>
              confirm("限定公開URLを再発行しますか？旧URLは次のビルドで見られなくなります。") &&
              action.mutate(() => api.rotateUnlistedKey(page.id))
            }
          >
            URLを再発行
          </button>
        )}
      </div>

      <h3>予約</h3>
      <div className="stack small">
        <div className="row">
          <select value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value as typeof scheduleKind)}>
            <option value="publish_page">{visibility === "unlisted" ? "限定公開" : "公開"}を予約</option>
            <option value="unpublish_page">非公開化を予約</option>
          </select>
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          <span className="muted">JST</span>
        </div>
        <button
          className="button"
          disabled={dirty || action.isPending || !runAt}
          title={dirty ? "先に保存してください" : undefined}
          onClick={() =>
            action.mutate(() =>
              api.createSchedule(
                scheduleKind === "publish_page"
                  ? { actionType: "publish_page", pageId: page.id, versionId: page.headVersionId, targetVisibility: visibility, runAt: jstLocalToIso(runAt) }
                  : { actionType: "unpublish_page", pageId: page.id, runAt: jstLocalToIso(runAt) },
              ),
            )
          }
        >
          予約する
        </button>
        <p className="muted">予約時点の版が公開されます。予約後の編集は含まれません。反映は予約時刻から数分以内です。</p>
      </div>
      {action.error && <p className="error small">{errorMessage(action.error)}</p>}

      {pending.length > 0 && (
        <ul className="plain small">
          {pending.map((a) => (
            <li key={a.id} className="stack">
              <div className="row">
                <span className={`badge ${a.status}`}>{statusLabel[a.status]}</span>
                <span className="grow">
                  {formatDateTime(a.runAt)} に{actionLabel(a)}
                </span>
                {(a.status === "scheduled" || a.status === "failed") && (
                  <button className="link danger" onClick={() => action.mutate(() => api.cancelSchedule(a.id))}>
                    キャンセル
                  </button>
                )}
              </div>
              {a.editedAfterSchedule && <span className="warn">予約後に編集があります（予約内容には反映されません。反映するなら予約し直してください）</span>}
              {a.lastError && <span className="error">{a.lastError}（{a.attempts}回試行）</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
