import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { audioIdsInBody, formatBytes, formatDuration, type PageAudio } from "@wiki/shared";
import { Trash2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { confirmDialog } from "./ConfirmDialog";
import { HelpHeading } from "./HelpTip";
import { Muted } from "./ui";

/** ページに添付した音声の一覧（本文のブロックも、下の一覧も、同じ取得を使う） */
export function usePageAudio(pageId: string | undefined) {
  return useQuery({ queryKey: ["page-audio", pageId], queryFn: () => api.listPageAudio(pageId!), enabled: pageId != null });
}

/** 音声を、確かめてから削除する。削除できたら `onDeleted` を呼ぶ */
export function useDeleteAudio(pageId: string, onDeleted?: () => void) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePageAudio(pageId, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["page-audio", pageId] });
      onDeleted?.();
    },
  });
  const confirmAndRemove = async (a: Pick<PageAudio, "id" | "name">) => {
    const ok = await confirmDialog({
      title: `音声「${a.name}」を削除しますか？`,
      body: "削除した音声は元に戻せません。本文に置いてあるときは、その場所からも消えます。",
      confirmLabel: "音声を削除する",
      cancelLabel: "削除しない",
      danger: true,
    });
    if (ok) remove.mutate(a.id);
  };
  return { remove: confirmAndRemove, pending: remove.isPending, error: remove.error };
}

/** 音声の 1 件。名前・長さ・大きさ・上げた人、再生、削除。 */
export function AudioCard({ pageId, audio, onRemove, removing }: { pageId: string; audio: PageAudio; onRemove: () => void; removing: boolean }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {audio.name}
        </Typography>
        <Muted sx={{ fontSize: "0.75rem" }}>
          {[audio.durationMs !== null ? formatDuration(audio.durationMs) : null, formatBytes(audio.bytes), formatDateTime(audio.createdAt), audio.createdByName].filter(Boolean).join("・")}
        </Muted>
        <Box component="audio" controls preload="none" src={api.pageAudioUrl(pageId, audio.id)} aria-label={`${audio.name}を再生`} sx={{ display: "block", width: "100%", maxWidth: 480, mt: 0.75 }} />
      </Box>
      <IconButton aria-label={`音声「${audio.name}」を削除`} onClick={onRemove} disabled={removing} sx={{ color: "error.main" }}>
        <Trash2 size={18} />
      </IconButton>
    </Box>
  );
}

/**
 * 編集画面の本文の下に出す、「本文に置いていない音声」の一覧。
 * 音声は「/」の「録音」「音声を添付」で本文に置く。ここに出るのは、本文に印（`@audio`）が無い音声
 * （本文のブロックを消した・以前の画面で添付した）で、再生と削除ができる。1件も無いページでは何も出さない。
 */
export function PageAudioSection({ pageId, bodyMd }: { pageId: string; bodyMd: string }) {
  const list = usePageAudio(pageId);
  const { remove, pending, error } = useDeleteAudio(pageId);
  const placed = new Set(audioIdsInBody(bodyMd));
  const items = (list.data?.audio ?? []).filter((a) => !placed.has(a.id));
  // 読み込み中・音声が無いときは出さない（音声を使わないページに、欄を付けない）
  if (!list.isError && items.length === 0) return null;

  return (
    <Box component="section" aria-labelledby="page-audio-heading" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: "divider" }}>
      <HelpHeading
        id="page-audio-heading"
        component="h2"
        variant="subtitle1"
        about="「本文に置いていない音声」"
        textSx={{ fontWeight: 700 }}
        help="このページに添付してあるが、本文に置いていない音声です。本文に置くには、本文で「/」を打って「音声を添付」を選びます。公開サイトには出ません。ここに残した音声は、連携したアプリ（MCP）が、期限つきの URL で取り出せます。"
      >
        本文に置いていない音声
      </HelpHeading>

      {error && (
        <Alert severity="error" role="alert" sx={{ mt: 1.5 }}>
          音声を削除できませんでした。{errorMessage(error)}
        </Alert>
      )}

      <Box component="ul" aria-label="本文に置いていない音声" sx={{ listStyle: "none", p: 0, m: 0, mt: 1.5, display: "grid", gap: 1 }}>
        {list.isError && (
          <Alert severity="error" component="li">
            音声の一覧を読み込めませんでした。{errorMessage(list.error)}
          </Alert>
        )}
        {items.map((a) => (
          <Box component="li" key={a.id}>
            <AudioCard pageId={pageId} audio={a} onRemove={() => void remove(a)} removing={pending} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
