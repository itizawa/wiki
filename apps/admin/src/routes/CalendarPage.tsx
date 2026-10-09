import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { isoToJstLocal, jstDate, jstLocalToIso, type ScheduledAction } from "@wiki/shared";
import { useMemo, useState } from "react";
import { actionLabel } from "../components/PublishPanel";
import { api, errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import ui from "../styles/ui.module.css";
import s from "./CalendarPage.module.css";

const DAY = 24 * 3600_000;
/** 予約ストックがこれを下回ったら警告する（今後 STOCK_DAYS 日の公開予約数） */
const STOCK_DAYS = 7;
const STOCK_MIN = 3;

type Entry =
  | { kind: "action"; at: string; action: ScheduledAction }
  | { kind: "published"; at: string; pageId: string; title: string; unlisted: boolean }
  | { kind: "draft"; at: string; pageId: string; title: string };

/** 編集カレンダー：公開済み・予約済み・AI下書きを日付で並べる。 */
export function CalendarPage() {
  const qc = useQueryClient();
  const [now] = useState(() => Date.now());
  const from = new Date(now - 14 * DAY).toISOString();
  const to = new Date(now + 60 * DAY).toISOString();
  const schedule = useQuery({ queryKey: ["schedule", "calendar", from], queryFn: () => api.listSchedule({ from, to }) });
  const failed = useQuery({ queryKey: ["schedule", "failed"], queryFn: () => api.listSchedule({ status: "failed" }) });
  const pages = useQuery({ queryKey: ["pages", ""], queryFn: () => api.listPages() });
  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });

  const days = useMemo(() => {
    const entries: Entry[] = [];
    for (const a of schedule.data?.actions ?? []) {
      if (a.status !== "canceled") entries.push({ kind: "action", at: a.runAt, action: a });
    }
    for (const p of pages.data?.pages ?? []) {
      const inRange = (iso: string) => iso >= from && iso < to;
      if (p.firstPublishedAt && inRange(p.firstPublishedAt) && p.publishedVersionId) {
        // 予約で公開されたものは予約側に出ているので重ねない
        const fromSchedule = (schedule.data?.actions ?? []).some(
          (a) => a.pageId === p.id && a.status === "done" && a.actionType === "publish_page" && a.runAt === p.firstPublishedAt,
        );
        if (!fromSchedule) entries.push({ kind: "published", at: p.firstPublishedAt, pageId: p.id, title: p.title, unlisted: p.visibility === "unlisted" });
      }
      if (p.origin === "ai_draft" && !p.publishedVersionId) {
        entries.push({ kind: "draft", at: p.updatedAt, pageId: p.id, title: p.title });
      }
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));
    const map = new Map<string, Entry[]>();
    for (const e of entries) map.set(jstDate(e.at), [...(map.get(jstDate(e.at)) ?? []), e]);
    return [...map];
  }, [schedule.data, pages.data, from, to]);

  const stock = (schedule.data?.actions ?? []).filter(
    (a) =>
      a.status === "scheduled" &&
      a.actionType === "publish_page" &&
      new Date(a.runAt).getTime() < now + STOCK_DAYS * DAY,
  ).length;
  const today = jstDate(new Date(now).toISOString());

  if (schedule.isPending || pages.isPending) return <p className={ui.muted}>読み込み中…</p>;
  if (schedule.error) return <p className={ui.error}>{errorMessage(schedule.error)}</p>;

  return (
    <div className={ui.stack}>
      <section className={stock < STOCK_MIN ? ui.cardWarn : ui.card}>
        <h2>予約ストック</h2>
        <p>
          今後{STOCK_DAYS}日の公開予約：<strong>{stock}件</strong>
          {stock < STOCK_MIN && <span className={ui.warn}>　予約が少なくなっています。継続配信が途切れないよう記事を予約してください。</span>}
        </p>
      </section>

      {(failed.data?.actions.length ?? 0) > 0 && (
        <section className={ui.card}>
          <h2 className={ui.error}>失敗した予約</h2>
          <ul className={ui.plainList}>
            {failed.data!.actions.map((a) => (
              <li key={a.id} className={ui.row}>
                <span className={ui.grow}>
                  <PageLink action={a} /> {actionLabel(a)}（{isoToJstLocal(a.runAt).replace("T", " ")}）
                  <span className={cx(ui.error, ui.small)}> {a.lastError}</span>
                </span>
                <button className={ui.linkDanger} onClick={() => mutate.mutate(() => api.cancelSchedule(a.id))}>
                  キャンセル
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={ui.card}>
        <h2>編集カレンダー</h2>
        <p className={cx(ui.muted, ui.small)}>過去14日〜60日先。時刻はJST。</p>
        {mutate.error && <p className={ui.error}>{errorMessage(mutate.error)}</p>}
        {days.length === 0 && <p className={ui.muted}>予定はありません。</p>}
        <div className={s.calendar}>
          {days.map(([day, entries]) => (
            <div key={day} className={day === today ? s.today : day < today ? s.past : s.day}>
              <h4>
                {day}
                {day === today && <span className={ui.badge}>今日</span>}
              </h4>
              <ul className={cx(ui.plainList, ui.small)}>
                {entries.map((e, i) => (
                  <li key={i} className={ui.row}>
                    <span className={cx(ui.mono, ui.muted)}>{isoToJstLocal(e.at).slice(11)}</span>
                    {e.kind === "action" && (
                      <>
                        <span className={cx(ui.badge, ui[e.action.status])}>{actionLabel(e.action)}</span>
                        <span className={ui.grow}>
                          <PageLink action={e.action} />
                          {e.action.editedAfterSchedule && <span className={ui.warn}> 予約後に編集あり</span>}
                          {e.action.status === "done" && <span className={ui.muted}> 実行済み</span>}
                        </span>
                        {e.action.status === "scheduled" && (
                          <>
                            <button
                              className={ui.link}
                              onClick={() => {
                                const next = prompt("新しい日時（JST, YYYY-MM-DDTHH:mm）", isoToJstLocal(e.action.runAt));
                                if (next) mutate.mutate(() => api.reschedule(e.action.id, jstLocalToIso(next)));
                              }}
                            >
                              変更
                            </button>
                            <button className={ui.linkDanger} onClick={() => mutate.mutate(() => api.cancelSchedule(e.action.id))}>
                              キャンセル
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {e.kind === "published" && (
                      <>
                        <span className={cx(ui.badge, e.unlisted ? ui.unlisted : ui.public)}>{e.unlisted ? "限定公開済み" : "公開済み"}</span>
                        <Link to="/pages/$pageId" params={{ pageId: e.pageId }}>
                          {e.title}
                        </Link>
                      </>
                    )}
                    {e.kind === "draft" && (
                      <>
                        <span className={ui.badge}>AI下書き</span>
                        <Link to="/pages/$pageId" params={{ pageId: e.pageId }}>
                          {e.title}
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PageLink({ action }: { action: ScheduledAction }) {
  if (!action.pageId) return <span>{action.branchName}</span>;
  return (
    <Link to="/pages/$pageId" params={{ pageId: action.pageId }}>
      {action.pageTitle ?? action.pageId}
    </Link>
  );
}
