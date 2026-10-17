import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { formatDuration, VOICE_MAX_MS } from "@wiki/shared";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HelpTip } from "../components/HelpTip";
import { Muted } from "../components/ui";
import { api } from "../lib/api";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { hasVoiceConsent, rememberVoiceConsent, VOICE_LIMIT_LABEL, voiceProblem, voiceTextToInsert } from "../lib/voiceInput";

/**
 * 声で本文を書くダイアログ（管理者だけ）。録音して、止めると書き起こし、カーソルの位置に文字を入れる。
 * 録音は 3 分で自動で止まる。音声は保存しない。初めて使うときだけ、音声を Cloudflare に送ることに同意してもらう。
 * 録音中・書き起こし中は、Esc や外側のクリックでは閉じない（録音が消えるため）。
 */
export function VoiceDialog(props: { open: boolean; onTranscribed: (text: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={(_e, reason) => {
        if (busy && (reason === "escapeKeyDown" || reason === "backdropClick")) return;
        props.onClose();
      }}
      fullWidth
      maxWidth="xs"
      // 閉じたあとのフォーカスは呼び出し側がエディタに戻す
      disableRestoreFocus
      slotProps={{ transition: { onExited: () => setBusy(false) } }}
    >
      <VoiceInput onTranscribed={props.onTranscribed} onClose={props.onClose} onBusyChange={setBusy} />
    </Dialog>
  );
}

/** 閉じると部品ごと消えるので、録音とマイクは閉じたときに止まる */
function VoiceInput({ onTranscribed, onClose, onBusyChange }: { onTranscribed: (text: string) => void; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const [consented, setConsented] = useState(hasVoiceConsent);
  const [error, setError] = useState<string | null>(null);
  // 書き起こしの途中で閉じたら、結果は入れない
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const transcribe = useMutation({
    mutationFn: (blob: Blob) => api.transcribeAudio(blob),
    onSuccess: ({ text }) => {
      if (closed.current) return;
      const insert = voiceTextToInsert(text);
      if (insert === null) return setError("声を聞き取れませんでした。マイクに近づいて、もう一度録音してください。");
      onTranscribed(insert);
    },
    onError: (err) => !closed.current && setError(voiceProblem(err)),
  });
  const recorder = useAudioRecorder({
    maxMs: VOICE_MAX_MS,
    onRecorded: ({ blob }) => transcribe.mutate(blob),
    onError: setError,
  });
  const { recording, elapsedMs } = recorder;
  const transcribing = transcribe.isPending;

  const busy = recording || transcribing;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const startRecording = async () => {
    setError(null);
    if (!consented) {
      rememberVoiceConsent();
      setConsented(true);
    }
    await recorder.start();
  };

  return (
    <>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        音声入力
        <HelpTip about="音声入力">
          録音を止めると、音声を Cloudflare の Workers AI（Whisper）に送って文字にし、カーソルの位置に入れます。音声はどこにも保存しません。句読点や言い直しは直さず、聞き取った文のまま入ります。
        </HelpTip>
      </DialogTitle>
      <DialogContent>
        {!recorder.canRecord ? (
          <Alert severity="warning">このブラウザでは録音できません。スマホのキーボードにある音声入力は使えます。</Alert>
        ) : (
          <>
            <Muted>{VOICE_LIMIT_LABEL}</Muted>

            {!consented && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                録音した音声は、書き起こすために Cloudflare に送ります。送った音声は保存しません。
              </Alert>
            )}

            {!recording && !transcribing && (
              <Box sx={{ mt: 1.5 }}>
                <Button variant="contained" startIcon={<Mic size={16} />} onClick={() => void startRecording()}>
                  {consented ? "録音を始める" : "同意して録音を始める"}
                </Button>
              </Box>
            )}

            {recording && (
              <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
                <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main" }} />
                  <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    録音中 {formatDuration(elapsedMs)} / {formatDuration(VOICE_MAX_MS)}
                  </Typography>
                </Box>
                <Button variant="contained" color="error" startIcon={<Square size={16} />} onClick={recorder.stop}>
                  録音を止めて書き起こす
                </Button>
              </Box>
            )}

            {transcribing && (
              <Box role="status" sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={16} />
                <Typography>書き起こしています…</Typography>
              </Box>
            )}
          </>
        )}

        {error && (
          <Alert severity="error" role="alert" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{recording ? "録音を捨てて閉じる" : transcribing ? "閉じる（入れない）" : "閉じる"}</Button>
      </DialogActions>
    </>
  );
}
