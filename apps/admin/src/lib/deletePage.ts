import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { childrenByParent, type TreeNode } from "@wiki/shared";
import { useRef } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { api } from "./api";
import { screenLink, useRefreshWikis } from "./wiki";

/** ゴミ箱に入れたページ。編集画面が、消したあとの移動で「下書きを保存できていません」と確かめないための目印。 */
const removed = new Set<string>();

export const wasPageRemoved = (pageId: string) => removed.has(pageId);

/** 編集画面を開いたときに呼ぶ（ゴミ箱から元に戻したページを、消したままの扱いにしない）。 */
export const forgetRemovedPage = (pageId: string) => void removed.delete(pageId);

/** ツリーで `pageId` の配下にあるページの id（子・孫…のすべて）。 */
export function descendantPageIds(nodes: readonly TreeNode[], pageId: string): string[] {
  const childrenOf = childrenByParent(nodes);
  const descendants: string[] = [];
  for (const stack = [pageId]; stack.length > 0; ) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      descendants.push(child.pageId);
      stack.push(child.nodeId);
    }
  }
  return descendants;
}

/** 確認ダイアログに出すための、ページの情報。ツリーを読めなかったときは、ここの値で確かめる。 */
export type PageToDelete = { id: string; title: string; publishedVersionId: string | null };

/**
 * ページをゴミ箱に入れる（確認ダイアログ → 実行）。編集画面の「…」と、サイドバーの行の「…」から使う。
 * - 開いているページ（か、その親）を入れたときは「すべてのページ」へ移る。`onLeave` は移ったあとに呼ぶ
 * - ほかのページを入れたときは、いまの画面のまま、ツリー・一覧などを読み直す
 */
export function useDeletePage(options: { onLeave?: () => void; onError?: (err: Error) => void } = {}) {
  const qc = useQueryClient();
  const refreshWikis = useRefreshWikis();
  const navigate = useNavigate();
  const { pageId: openPageId } = useParams({ strict: false });
  // 実行が終わった時点で開いているページを見る
  const latest = useRef({ openPageId, options });
  latest.current = { openPageId, options };

  const remove = useMutation({
    mutationFn: ({ id }: { id: string; pageIds: string[] }) => api.deletePage(id),
    onSuccess: async (_result, { pageIds }) => {
      for (const id of pageIds) removed.add(id);
      // 公開中のページを入れると、wiki の一覧に出す「公開中のページ」の件数が減る
      void refreshWikis();
      const open = latest.current.openPageId;
      if (open && pageIds.includes(open)) {
        await qc.invalidateQueries();
        await navigate(screenLink("/w/$wikiKey"));
        latest.current.options.onLeave?.();
        return;
      }
      for (const key of ["structure", "history", "pages", "search", "stars", "trash", "schedule"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => {
      // ツリーが別の操作で変わっていたとき（head_moved）に、最新のツリーを出す
      void qc.invalidateQueries({ queryKey: ["structure"] });
      latest.current.options.onError?.(err);
    },
  });

  const confirmAndDelete = async (page: PageToDelete) => {
    // 配下のページもいっしょにゴミ箱に入るので、何ページあるかを最新のツリーから数える
    // 取ったばかりのツリーがあっても、取り直す（staleTime: 0）
    const structure = await qc.fetchQuery({ queryKey: ["structure"], queryFn: api.structure, staleTime: 0 }).catch(() => null);
    const descendants = descendantPageIds(structure?.trees[0]?.nodes ?? [], page.id);
    const current = structure?.pages[page.id] ?? page;
    const published = (current.publishedVersionId ? 1 : 0) + descendants.filter((id) => structure?.pages[id]?.publishedVersionId).length;
    const ok = await confirmDialog({
      title: `「${current.title}」をゴミ箱に入れますか？`,
      body: [
        descendants.length > 0 ? `配下の ${descendants.length} ページもいっしょにゴミ箱に入り、ツリーから外れます。` : "ツリーから外れます。",
        published > 0 &&
          (descendants.length > 0
            ? `公開中の ${published} ページは、公開サイトから見られなくなります。`
            : "公開中のページなので、公開サイトからも見られなくなります。"),
        "あとで「ゴミ箱」から元に戻せます（非公開のページとして戻り、公開と予約は戻りません）。",
      ]
        .filter(Boolean)
        .join(""),
      confirmLabel: "ゴミ箱に入れる",
      cancelLabel: "ゴミ箱に入れない",
      // ゴミ箱から戻せるが、公開は戻らないので、公開中のページを含むときだけ赤にする
      danger: published > 0,
    });
    if (ok) remove.mutate({ id: page.id, pageIds: [page.id, ...descendants] });
  };

  return { confirmAndDelete, error: remove.error, isPending: remove.isPending };
}
