import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, currentWikiKey } from "./api";
import { FIRST_WIKI } from "./wiki";

const QUERY_KEY = ["stars"] as const;
const MUTATION_KEY = ["stars", "change"] as const;
/** サーバーに移す前、スターを覚えさせていた localStorage のキー。 */
const LEGACY_KEY = "wiki.stars";
const NONE: string[] = [];

type Stars = { pageIds: string[] };

/** スターの付け外し。付けたものは末尾に足す。 */
export function toggleStar(ids: readonly string[], pageId: string): string[] {
  return ids.includes(pageId) ? ids.filter((id) => id !== pageId) : [...ids, pageId];
}

/** 並び替え：`pageId` を `overId` のある位置へ動かす。 */
export function moveStar(ids: readonly string[], pageId: string, overId: string): string[] {
  const from = ids.indexOf(pageId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = ids.filter((id) => id !== pageId);
  next.splice(to, 0, pageId);
  return next;
}

/** localStorage に残っている、以前のスター（ページ id の配列）。壊れた値は捨てる。 */
export function parseLegacyStars(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * スターを付けたページ（よく開くページの目印）。管理者ごとにサーバーに持つので、別のブラウザや端末でも同じものが出る。
 * サイドバー・編集画面・一覧のどこで変えてもすぐ揃う。押した結果は先に画面へ出し、失敗したら元に戻す。
 */
export function useStars(): { ids: string[]; toggle: (pageId: string) => void; reorder: (pageIds: string[]) => void } {
  const qc = useQueryClient();
  const stars = useQuery({ queryKey: QUERY_KEY, queryFn: api.listStars, staleTime: 60_000 });
  const ids = stars.data?.pageIds ?? NONE;

  const optimistic = <T,>(next: (current: string[], input: T) => string[]) => ({
    onMutate: async (input: T) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<Stars>(QUERY_KEY);
      qc.setQueryData<Stars>(QUERY_KEY, { pageIds: next(previous?.pageIds ?? [], input) });
      return { previous };
    },
    onError: (_err: Error, _input: T, context: { previous: Stars | undefined } | undefined) => {
      qc.setQueryData(QUERY_KEY, context?.previous);
    },
    onSuccess: (data: Stars) => qc.setQueryData(QUERY_KEY, data),
  });

  const toggle = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ pageId, on }: { pageId: string; on: boolean }) => (on ? api.addStar(pageId) : api.removeStar(pageId)),
    ...optimistic<{ pageId: string; on: boolean }>((current, { pageId, on }) => (on === current.includes(pageId) ? current : toggleStar(current, pageId))),
  });
  const reorder = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: (pageIds: string[]) => api.reorderStars(pageIds),
    ...optimistic<string[]>((_current, pageIds) => pageIds),
  });

  return {
    ids,
    toggle: (pageId) => toggle.mutate({ pageId, on: !ids.includes(pageId) }),
    reorder: (pageIds) => reorder.mutate(pageIds),
  };
}

/**
 * スターの変更の失敗。どの画面のボタンで起きたものでも拾う（画面には1か所でまとめて出す）。
 * 2つ目の値を呼ぶと、出し終えた失敗を消す。
 */
export function useStarsError(): [Error | null, () => void] {
  const qc = useQueryClient();
  const errors = useMutationState({ filters: { mutationKey: MUTATION_KEY, status: "error" }, select: (m) => m.state.error });
  const clear = () => {
    const cache = qc.getMutationCache();
    for (const m of cache.findAll({ mutationKey: MUTATION_KEY, status: "error" })) cache.remove(m);
  };
  return [errors.at(-1) ?? null, clear];
}

/**
 * 以前このブラウザに覚えさせていたスターを、サーバーへ移す（1回だけ）。
 * 全部移せたら localStorage から消す。途中で失敗したら残しておき、次に開いたときにやり直す。
 * その頃のページは最初の wiki にあるので、最初の wiki を開いたときにだけ移す
 * （ほかの wiki で移すと、どのページも「無い」と返り、スターを捨ててしまう）。
 */
export function useMigrateLegacyStars() {
  const qc = useQueryClient();
  useEffect(() => {
    if (currentWikiKey() !== FIRST_WIKI) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_KEY);
    } catch {
      return;
    }
    if (raw === null) return;
    void (async () => {
      for (const pageId of parseLegacyStars(raw)) {
        try {
          await api.addStar(pageId);
        } catch (err) {
          // もう無いページのスターは捨てる。それ以外の失敗は、次の機会にやり直す
          if (!(err instanceof Error && "status" in err && err.status === 404)) return;
        }
      }
      localStorage.removeItem(LEGACY_KEY);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    })();
  }, [qc]);
}
