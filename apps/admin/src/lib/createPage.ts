import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "./api";
import { invalidatePageLists } from "./invalidatePageLists";
import { markJustCreated } from "./newPage";
import { UNTITLED_TITLE } from "./untitled";
import { pageLink } from "./wiki";

/** 作るページ。タイトルが空なら「無題」、親ページが無ければ最上位の末尾に作る。 */
export type NewPageInput = { title?: string; parentPageId?: string | null };

/** 作る API に渡す中身。 */
export function newPageRequest(input: NewPageInput): { title: string; parentPageId?: string | null } {
  return { title: input.title || UNTITLED_TITLE, parentPageId: input.parentPageId };
}

/**
 * 作ったあとの動き：ページの一覧（ツリー・一覧・検索）を取り直し、作った直後の印を付けて、そのページのエディタを開く。
 * `onCreated` は、エディタへ移る前に呼ぶ（コマンドメニューを閉じる、スマホのサイドバーを閉じるなど）。
 */
export function newPageCallbacks(qc: QueryClient, navigate: (to: ReturnType<typeof pageLink>) => Promise<unknown>, onCreated?: () => void) {
  return {
    onSettled: () => invalidatePageLists(qc),
    onSuccess: async (page: { id: string }) => {
      markJustCreated(page.id);
      onCreated?.();
      await navigate(pageLink(page.id));
    },
  };
}

/** 新しいページを作り、そのエディタを開く。サイドバー・「すべてのページ」・コマンドメニューの「新しいページ」が使う。 */
export function useCreatePage(options: { onCreated?: () => void } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: NewPageInput) => api.createPage(newPageRequest(input)),
    ...newPageCallbacks(qc, (to) => navigate(to), options.onCreated),
  });
}
