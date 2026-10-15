import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUDIO_ACCEPT, AUDIO_LIMIT_LABEL, formatBytes, formatDuration, type PageAudio } from "@wiki/shared";
import { FileUp, Mic, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { audioFileProblem, microphoneProblem, pickRecorderType, readAudioDuration, recordingName } from "../lib/pageAudio";
import { confirmDialog } from "./ConfirmDialog";
import { HelpHeading } from "./HelpTip";
import { Muted } from "./ui";

/** 録った音声。聞き直してから上げる */
type Recorded = { blob: Blob; url: string; name: string; durationMs: number };

/**
 * 編集画面の本文の下に置く「音声」の場所。動画のナレーションなど、公開前の素材を添付する。
 * 本文の Markdown には何も書かず、公開サイトにも出さない。ブラウザで録音して（聞き直してから上げる）か、手元の音声ファイルを上げる。
 */
export function PageAudioSection({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const queryKey = ["page-audio", pageId];
  const list = useQuery({ queryKey, queryFn: () => api.listPageAudio(pageId) });
  const recorderType = useRef(pickRecorderType()).current;
  const canRecord = recorderType !== null && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; timer: number } | null>(null);

  const upload = useMutation({
    mutationFn: (v: { blob: Blob; name: string; durationMs: number | null }) => api.uploadPageAudio(pageId, v.blob, { name: v.name, durationMs: v.durationMs }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePageAudio(pageId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  // 聞き直しの URL は、捨てるときに解放する。画面を離れたら、録音もマイクも止める
  useEffect(() => () => void (recorded && URL.revokeObjectURL(recorded.url)), [recorded]);
  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      window.clearInterval(s.timer);
      s.recorder.onstop = null;
      if (s.recorder.state !== "inactive") s.recorder.stop();
      s.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const startRecording = async () => {
    setError(null);
    discard();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(microphoneProblem(err));
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: recorderType! });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      const s = session.current;
      session.current = null;
      stream.getTracks().forEach((t) => t.stop());
      if (s) window.clearInterval(s.timer);
      setRecording(false);
      const blob = new Blob(chunks, { type: recorderType! });
      // MediaRecorder の WebM は長さが入らないことがあるので、測った長さではなく、録っていた時間を使う
      const durationMs = Date.now() - (s?.startedAt ?? Date.now());
      if (blob.size === 0) return setError("音声が録れていません。マイクが動いているか確かめて、もう一度録音してください。");
      setRecorded({ blob, url: URL.createObjectURL(blob), name: recordingName(new Date(), recorderType!), durationMs });
    };
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    session.current = { recorder, stream, chunks, startedAt, timer };
    setElapsedMs(0);
    setRecording(true);
    recorder.start();
  };

  const stopRecording = () => session.current?.recorder.stop();

  const discard = () => setRecorded(null);

  const uploadRecorded = () => {
    if (!recorded) return;
    setError(null);
    upload.mutate(
      { blob: recorded.blob, name: recorded.name, durationMs: recorded.durationMs },
      { onSuccess: () => setRecorded(null), onError: (err) => setError(`音声を上げられませんでした。${errorMessage(err)}`) },
    );
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const problem = audioFileProblem(file);
    if (problem) return setError(problem);
    const durationMs = await readAudioDuration(file);
    upload.mutate({ blob: file, name: file.name, durationMs }, { onError: (err) => setError(`音声を上げられませんでした。${errorMessage(err)}`) });
  };

  const removeAudio = async (a: PageAudio) => {
    const ok = await confirmDialog({
      title: `音声「${a.name}」を削除しますか？`,
      body: "削除した音声は元に戻せません。",
      confirmLabel: "音声を削除する",
      cancelLabel: "削除しない",
      danger: true,
    });
    if (ok) remove.mutate(a.id);
  };

  const busy = upload.isPending;
  const items = list.data?.audio ?? [];

  return (
    <Box component="section" aria-labelledby="page-audio-heading" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: "divider" }}>
      <HelpHeading
        id="page-audio-heading"
        component="h2"
        variant="subtitle1"
        about="「音声」"
        textSx={{ fontWeight: 700 }}
        help="動画のナレーションなど、公開前の素材を置く場所です。本文には書かれず、公開サイトにも出ません。ここに上げた音声は、連携したアプリ（MCP）が、期限つきの URL で取り出せます。"
      >
        音声
      </HelpHeading>
      <Muted sx={{ mt: 0.5 }}>{AUDIO_LIMIT_LABEL}</Muted>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
        {canRecord &&
          (recording ? (
            <Button variant="contained" color="error" startIcon={<Square size={16} />} onClick={stopRecording}>
              録音を止める
            </Button>
          ) : (
            <Button variant="contained" startIcon={<Mic size={16} />} onClick={() => void startRecording()} disabled={busy}>
              録音する
            </Button>
          ))}
        <Button variant="outlined" startIcon={<FileUp size={16} />} onClick={() => fileInput.current?.click()} disabled={busy || recording}>
          ファイルを選ぶ
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
      {!canRecord && <Muted sx={{ mt: 1 }}>このブラウザでは録音できません。手元で録った音声を「ファイルを選ぶ」から上げてください。</Muted>}

      {recording && (
        <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
          <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main" }} />
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>録音中 {formatDuration(elapsedMs)}</Typography>
        </Box>
      )}

      {recorded && (
        <Box sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            録音を聞き直す（{formatDuration(recorded.durationMs)}）
          </Typography>
          <Box component="audio" controls src={recorded.url} aria-label="録音の聞き直し" sx={{ display: "block", width: "100%", maxWidth: 480, mt: 1 }} />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
            <Button variant="contained" onClick={uploadRecorded} disabled={busy} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
              {busy ? "上げています" : "この録音を上げる"}
            </Button>
            <Button variant="outlined" color="inherit" onClick={() => void startRecording()} disabled={busy}>
              撮り直す
            </Button>
            <Button color="inherit" onClick={discard} disabled={busy}>
              録音を捨てる
            </Button>
          </Box>
        </Box>
      )}

      {busy && !recorded && (
        <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
          <CircularProgress size={16} />
          <Muted>ファイルを上げています</Muted>
        </Box>
      )}

      {error && (
        <Alert severity="error" role="alert" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}
      {remove.error && (
        <Alert severity="error" role="alert" sx={{ mt: 1.5 }}>
          音声を削除できませんでした。{errorMessage(remove.error)}
        </Alert>
      )}

      <Box component="ul" aria-label="添付した音声" sx={{ listStyle: "none", p: 0, m: 0, mt: 2, display: "grid", gap: 1 }}>
        {list.isError && (
          <Alert severity="error" component="li">
            音声の一覧を読み込めませんでした。{errorMessage(list.error)}
          </Alert>
        )}
        {list.isSuccess && items.length === 0 && !recording && !recorded && (
          <Muted component="li">まだ音声はありません。「録音する」か「ファイルを選ぶ」から添付できます。</Muted>
        )}
        {items.map((a) => (
          <Box component="li" key={a.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                {a.name}
              </Typography>
              <Muted sx={{ fontSize: "0.75rem" }}>
                {[a.durationMs !== null ? formatDuration(a.durationMs) : null, formatBytes(a.bytes), formatDateTime(a.createdAt), a.createdByName].filter(Boolean).join("・")}
              </Muted>
              <Box component="audio" controls preload="none" src={api.pageAudioUrl(pageId, a.id)} aria-label={`${a.name}を再生`} sx={{ display: "block", width: "100%", maxWidth: 480, mt: 0.75 }} />
            </Box>
            <IconButton aria-label={`音声「${a.name}」を削除`} onClick={() => void removeAudio(a)} disabled={remove.isPending} sx={{ color: "error.main" }}>
              <Trash2 size={18} />
            </IconButton>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
