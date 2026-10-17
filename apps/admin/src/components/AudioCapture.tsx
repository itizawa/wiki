import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AUDIO_ACCEPT, AUDIO_LIMIT_LABEL, formatDuration, type PageAudio } from "@wiki/shared";
import { FileUp, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { audioFileProblem, readAudioDuration, recordingName } from "../lib/pageAudio";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { Muted } from "./ui";

/** 録った音声。聞き直してから上げる */
type Recorded = { blob: Blob; url: string; name: string; durationMs: number };

/**
 * ページに音声を添付する部品。ブラウザで録音して（止める → 聞き直す → 上げる）か、手元の音声ファイルを選んで上げる。
 * 上げ終えたら `onUploaded` に添付した音声を渡す（置く場所は呼び出し側が決める）。
 * `onDirtyChange`: 録音中・聞き直し中・上げている途中（閉じると録音が失われる状態）かどうか
 */
export function AudioCapture({
  pageId,
  mode,
  onUploaded,
  onDirtyChange,
}: {
  pageId: string;
  mode: "record" | "file";
  onUploaded: (audio: PageAudio) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder({
    onRecorded: ({ blob, durationMs, type }) => setRecorded({ blob, url: URL.createObjectURL(blob), name: recordingName(new Date(), type), durationMs }),
    onError: setError,
  });
  const { canRecord, recording, elapsedMs } = recorder;

  const upload = useMutation({
    mutationFn: (v: { blob: Blob; name: string; durationMs: number | null }) => api.uploadPageAudio(pageId, v.blob, { name: v.name, durationMs: v.durationMs }),
    onSuccess: (audio) => {
      void qc.invalidateQueries({ queryKey: ["page-audio", pageId] });
      setRecorded(null);
      onUploaded(audio);
    },
    onError: (err) => setError(`音声を上げられませんでした。${errorMessage(err)}`),
  });

  const busy = upload.isPending;
  const dirty = recording || recorded !== null || busy;
  const onDirty = useRef(onDirtyChange);
  onDirty.current = onDirtyChange;
  useEffect(() => onDirty.current?.(dirty), [dirty]);

  // 聞き直しの URL は、捨てるときに解放する
  useEffect(() => () => void (recorded && URL.revokeObjectURL(recorded.url)), [recorded]);

  const startRecording = async () => {
    setError(null);
    setRecorded(null);
    await recorder.start();
  };

  const stopRecording = recorder.stop;

  const uploadRecorded = () => {
    if (!recorded) return;
    setError(null);
    upload.mutate({ blob: recorded.blob, name: recorded.name, durationMs: recorded.durationMs });
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const problem = audioFileProblem(file);
    if (problem) return setError(problem);
    const durationMs = await readAudioDuration(file);
    upload.mutate({ blob: file, name: file.name, durationMs });
  };

  return (
    <Box>
      <Muted>{AUDIO_LIMIT_LABEL}</Muted>

      {mode === "record" && !canRecord && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          このブラウザでは録音できません。手元で録った音声は、「/」の「音声を添付」から上げられます。
        </Alert>
      )}

      {mode === "record" && canRecord && !recording && !recorded && (
        <Box sx={{ mt: 1.5 }}>
          <Button variant="contained" startIcon={<Mic size={16} />} onClick={() => void startRecording()}>
            録音を始める
          </Button>
        </Box>
      )}

      {recording && (
        <Box sx={{ mt: 1.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
          <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main" }} />
            <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>録音中 {formatDuration(elapsedMs)}</Typography>
          </Box>
          <Button variant="contained" color="error" startIcon={<Square size={16} />} onClick={stopRecording}>
            録音を止める
          </Button>
        </Box>
      )}

      {recorded && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            録音を聞き直す（{formatDuration(recorded.durationMs)}）
          </Typography>
          <Box component="audio" controls src={recorded.url} aria-label="録音の聞き直し" sx={{ display: "block", width: "100%", mt: 1 }} />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
            <Button variant="contained" onClick={uploadRecorded} disabled={busy} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
              {busy ? "上げています" : "この録音を本文に入れる"}
            </Button>
            <Button variant="outlined" color="inherit" onClick={() => void startRecording()} disabled={busy}>
              録り直す
            </Button>
            <Button color="inherit" onClick={() => setRecorded(null)} disabled={busy}>
              録音を捨てる
            </Button>
          </Box>
        </Box>
      )}

      {mode === "file" && (
        <Box sx={{ mt: 1.5 }}>
          <Button
            variant="contained"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <FileUp size={16} />}
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            {busy ? "上げています" : "ファイルを選ぶ"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={AUDIO_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void pickFile(file);
            }}
          />
        </Box>
      )}

      {error && (
        <Alert severity="error" role="alert" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
