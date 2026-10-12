import { Trash2, Undo2 } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrashedPage } from "@wiki/shared";
import { useMemo, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Muted, RouterLink, Row, Section, SkeletonSection } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { focusAfterRemoval, focusWhenReady } from "../lib/focus";
import { formatDateTime } from "../lib/format";
import { pageLink } from "../lib/wiki";

/** 元に戻した行。一覧からは消えるので、戻したことをその行があった場所に出し続ける */
type Restored = TrashedPage & { parentMissing: boolean };

const withDescendants = (p: TrashedPage) => (p.descendantCount > 0 ? `と配下の ${p.descendantCount} ページ` : "");

/** ゴミ箱：削除したページの一覧。配下ごと元に戻す・完全に削除する。 */
export function TrashPage() {
  const qc = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.listTrash });
  const [restored, setRestored] = useState<Restored[]>([]);
  /** 失敗した行と、その理由。その行のそばに出す */
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  const fail = (id: string, err: unknown) => {
    // 別の画面や外部のアプリが、先に戻したか消した
    const gone = err instanceof ApiError && err.status === 404;
    setFailed({ id, message: gone ? "このページは、もうゴミ箱にありません。一覧を読み込み直しました。" : errorMessage(err) });
    if (gone) void qc.invalidateQueries({ queryKey: ["trash"] });
  };

  const restore = useMutation({
    mutationFn: (p: TrashedPage) => api.restorePage(p.id),
    onMutate: () => setFailed(null),
    onSuccess: (result, p) => {
      setRestored((list) => [...list, { ...p, parentMissing: result.parentMissing }]);
      // ツリー・一覧・検索・スターに、戻したページがまた出る
      void qc.invalidateQueries();
      // 押した「元に戻す」は、戻したことを知らせる行に置き換わる。その行の「開く」リンクにフォーカスを移す
      focusWhenReady(`[data-trash-row="${p.id}"] a[href]`);
    },
    onError: (err, p) => fail(p.id, err),
  });
  const purge = useMutation({
    mutationFn: (p: TrashedPage) => api.purgePage(p.id),
    onMutate: () => setFailed(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trash"] }),
    onError: (err, p) => fail(p.id, err),
  });
  const busy = restore.isPending || purge.isPending;

  const confirmPurge = async (p: TrashedPage, button: HTMLElement) => {
    const row = button.closest("[data-trash-row]");
    const restoreFocus = focusAfterRemoval(row, {
      scope: row?.parentElement,
      focusSelector: "[data-trash-row] button:not(:disabled), [data-trash-row] a[href]",
      fallback: () => document.getElementById("trash-heading"),
    });
    const ok = await confirmDialog({
      title: `「${p.title}」を完全に削除しますか？`,
      body: `${p.descendantCount > 0 ? `配下の ${p.descendantCount} ページも、いっしょに完全に削除します。` : ""}本文と版履歴が消え、元に戻せません。`,
      confirmLabel: "完全に削除する",
      cancelLabel: "削除しない",
      danger: true,
    });
    // 消える行の、次の行（無ければ前の行。空になったら見出し）にフォーカスを移す。確認ダイアログを開く前の位置で決める
    if (ok) purge.mutate(p, { onSuccess: restoreFocus });
  };

  // 戻した行も、ゴミ箱に入れた日時の順のまま、元の場所に出す
  const rows = useMemo(() => {
    const inTrash = trash.data?.pages ?? [];
    const ids = new Set(inTrash.map((p) => p.id));
    const done = restored.filter((p) => !ids.has(p.id));
    return [...inTrash.map((p) => ({ page: p, restored: null as Restored | null })), ...done.map((p) => ({ page: p, restored: p }))].sort(
      (a, b) => b.page.deletedAt.localeCompare(a.page.deletedAt) || a.page.id.localeCompare(b.page.id),
    );
  }, [trash.data, restored]);

  return (
    <Stack spacing={1.5}>
      <Section>
        <HelpHeading
          variant="h6"
          component="h2"
          id="trash-heading"
          tabIndex={-1}
          textSx={{ outline: "none" }}
          help="削除したページが、配下のページといっしょに入ります。「元に戻す」で、配下ごとツリーに戻せます（非公開のページとして戻り、公開と予約は戻りません）。自動では消えず、「完全に削除」するまで残ります。"
        >
          ゴミ箱
        </HelpHeading>
      </Section>

      {trash.error && <Alert severity="error">{errorMessage(trash.error)}</Alert>}
      {/* ゴミ箱の行のカード（タイトル + 削除した日時）の形 */}
      {trash.isPending && [0, 1].map((i) => <SkeletonSection key={i} lines={1} />)}
      {trash.data && rows.length === 0 && (
        <Section>
          <Typography component="p" sx={{ fontWeight: 600 }}>
            ゴミ箱は空です
          </Typography>
          <Muted>ページを削除する（編集画面の「…」メニューの「ゴミ箱に入れる」）と、ここに入ります。</Muted>
        </Section>
      )}
      {rows.map(({ page: p, restored: done }) =>
        done ? (
          <Alert key={p.id} data-trash-row={p.id} severity="success" variant="outlined">
            「{p.title}」{withDescendants(p)}を元に戻しました。
            {done.parentMissing ? "元の親ページが無いため、最上位の末尾に置きました。" : ""}非公開のページとして戻っています。{" "}
            <RouterLink {...pageLink(p.id)}>「{p.title}」を開く</RouterLink>
          </Alert>
        ) : (
          <Section key={p.id} data-trash-row={p.id}>
            <Row sx={{ justifyContent: "space-between" }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="h3" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                  {p.title}
                </Typography>
                <Muted>
                  削除した日時 <time dateTime={p.deletedAt}>{formatDateTime(p.deletedAt)}</time>
                  {" ・ "}
                  {p.descendantCount > 0 ? `配下の ${p.descendantCount} ページもいっしょ` : "配下のページなし"}
                </Muted>
              </Box>
              {/* 取り返しのつかない「完全に削除」は、「元に戻す」から離して置く */}
              <Row spacing={3}>
                <Button variant="outlined" startIcon={<Undo2 size={18} />} disabled={busy} onClick={() => restore.mutate(p)}>
                  元に戻す
                </Button>
                <Button color="error" startIcon={<Trash2 size={18} />} disabled={busy} onClick={(e) => void confirmPurge(p, e.currentTarget)}>
                  完全に削除…
                </Button>
              </Row>
            </Row>
            {failed?.id === p.id && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {failed.message}
              </Alert>
            )}
          </Section>
        ),
      )}
      {/* 一覧から消えた行（先に戻された・消された）の失敗も、落とさずに出す */}
      {failed && !rows.some((r) => r.page.id === failed.id && !r.restored) && <Alert severity="error">{failed.message}</Alert>}
    </Stack>
  );
}
