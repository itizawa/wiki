import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import type { PageAudio } from "@wiki/shared";
import { useState } from "react";
import { AudioCapture } from "../components/AudioCapture";
import { Muted } from "../components/ui";

/**
 * 音声を録って、または選んで、本文のカーソル位置に入れるダイアログ。
 * 録音中・聞き直し中・上げている途中は、Esc や外側のクリックでは閉じない（録音が消えるため）。
 */
export function AudioDialog(props: { open: boolean; mode: "record" | "file"; pageId: string | undefined; onUploaded: (audio: PageAudio) => void; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={(_e, reason) => {
        if (dirty && (reason === "escapeKeyDown" || reason === "backdropClick")) return;
        props.onClose();
      }}
      fullWidth
      maxWidth="xs"
      // 閉じたあとのフォーカスは呼び出し側がエディタに戻す
      disableRestoreFocus
      slotProps={{ transition: { onExited: () => setDirty(false) } }}
    >
      <DialogTitle>{props.mode === "record" ? "音声を録音して挿入" : "音声ファイルを挿入"}</DialogTitle>
      <DialogContent>
        {props.pageId ? (
          <AudioCapture pageId={props.pageId} mode={props.mode} onUploaded={props.onUploaded} onDirtyChange={setDirty} />
        ) : (
          <Muted>音声は、ページの本文にだけ入れられます。</Muted>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={props.onClose}>{dirty && props.mode === "record" ? "録音を捨てて閉じる" : dirty ? "閉じる" : "挿入しない"}</Button>
      </DialogActions>
    </Dialog>
  );
}
