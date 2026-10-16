import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useParams } from "@tanstack/react-router";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { errorMessage } from "../lib/api";
import { AudioCard, useDeleteAudio, usePageAudio } from "../components/PageAudio";
import { Muted } from "../components/ui";

/**
 * 編集中の `@audio`。添付した音声の名前・長さと、再生、削除を出す。
 * 削除は音声そのものを消す（ブロックだけを消したいときは、ブロックを選んで Backspace。音声は「本文に置いていない音声」に残る）。
 * ページを開いていない画面（テンプレートなど）では、音声を引けないので、その旨だけを出す。
 */
export function PageAudioView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const id = String(node.attrs.id);
  const { pageId } = useParams({ strict: false }) as { pageId?: string };
  const list = usePageAudio(pageId);
  const { remove, pending, error } = useDeleteAudio(pageId ?? "", deleteNode);
  const audio = list.data?.audio.find((a) => a.id === id);

  return (
    <NodeViewWrapper data-page-audio={id} role="group" aria-label="音声" contentEditable={false} style={{ margin: "12px 0" }}>
      <Box sx={{ outline: selected ? "2px solid" : "none", outlineColor: "primary.main", borderRadius: 1 }}>
        {!pageId ? (
          <Muted>音声は、ページの本文にだけ置けます。</Muted>
        ) : list.isError ? (
          <Alert severity="error">音声を読み込めませんでした。{errorMessage(list.error)}</Alert>
        ) : !list.isSuccess ? (
          <Muted>音声を読み込んでいます</Muted>
        ) : audio ? (
          <AudioCard pageId={pageId} audio={audio} onRemove={() => void remove(audio)} removing={pending} />
        ) : (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => deleteNode()}>
                このブロックを消す
              </Button>
            }
          >
            この音声は削除されています。
          </Alert>
        )}
        {error && (
          <Alert severity="error" role="alert" sx={{ mt: 1 }}>
            音声を削除できませんでした。{errorMessage(error)}
          </Alert>
        )}
      </Box>
    </NodeViewWrapper>
  );
}
