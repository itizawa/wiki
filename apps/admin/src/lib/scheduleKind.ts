import type { PublishVisibility, ScheduledAction, Visibility } from "@wiki/shared";

export type ScheduleKind = "publish_page" | "unpublish_page";

export type ScheduleChoice = { value: ScheduleKind; label: string; disabled: boolean };

export type ScheduleState = {
  /** いま公開中（限定公開を含む）か */
  published: boolean;
  /** いまの公開範囲 */
  current: Visibility;
  /** 「公開」の節で選んでいる公開範囲。公開の予約は、この範囲で入る */
  target: PublishVisibility;
  /** 公開版より新しい版があるか */
  hasNewerVersion: boolean;
  /** まだ版になっていない変更があるか */
  dirty: boolean;
  /** このページの予約 */
  actions: readonly Pick<ScheduledAction, "actionType" | "status">[];
};

const publishLabel: Record<PublishVisibility, string> = { public: "公開", unlisted: "限定公開" };

/**
 * 「予約」で選べる操作。実行しても何も変わらない予約は選べなくし、理由を文言に添える。
 *
 * - 公開の予約：公開中で、公開範囲も版もいまと同じなら、何も変わらない。
 *   先に非公開化の予約が入っていれば、そのあとにもう一度公開する使い方があるので選べる
 * - 非公開化の予約：非公開なら何も変わらない。先に公開の予約が入っていれば選べる
 *
 * 選べる公開の予約は、実際に起きること（公開範囲の変更・公開し直し）を文言にする。
 * `picked` が無い、または選べなくなっていれば、選べるものを `kind` に返す（公開の予約を先に見る）。
 */
export function scheduleChoices(state: ScheduleState, picked: ScheduleKind | null): { kind: ScheduleKind; choices: ScheduleChoice[] } {
  const { published, current, target, hasNewerVersion, dirty } = state;
  // これから実行される予約だけを見る（失敗した予約は、もう実行されない）
  const upcoming = (kind: ScheduleKind) => state.actions.some((a) => a.actionType === kind && (a.status === "scheduled" || a.status === "running"));
  const unpublishFirst = upcoming("unpublish_page");
  const name = publishLabel[target];

  const publish = ((): Omit<ScheduleChoice, "value"> => {
    if (!published) return { label: `${name}を予約`, disabled: false };
    if (target !== current) return { label: `${name}への変更を予約`, disabled: false };
    if (dirty) return { label: "いまの内容での公開し直しを予約", disabled: false };
    if (hasNewerVersion) return { label: "最新版での公開し直しを予約", disabled: false };
    if (unpublishFirst) return { label: `非公開化のあとに${name}を予約`, disabled: false };
    return { label: `${name}を予約（いまの版をすでに${name}中）`, disabled: true };
  })();
  const unpublish: Omit<ScheduleChoice, "value"> =
    published || upcoming("publish_page") ? { label: "非公開化を予約", disabled: false } : { label: "非公開化を予約（いまは非公開）", disabled: true };

  const choices: ScheduleChoice[] = [
    { value: "publish_page", ...publish },
    { value: "unpublish_page", ...unpublish },
  ];
  const usable = (kind: ScheduleKind | null) => choices.some((c) => c.value === kind && !c.disabled);
  // 公開中なら非公開化を、非公開なら公開を必ず選べるので、どちらも選べないことは無い
  const kind = picked && usable(picked) ? picked : usable("publish_page") ? "publish_page" : "unpublish_page";
  return { kind, choices };
}
