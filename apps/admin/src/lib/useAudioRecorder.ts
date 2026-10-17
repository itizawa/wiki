import { useEffect, useRef, useState } from "react";
import { microphoneProblem, pickRecorderType } from "./pageAudio";

/** 録り終えた音声 */
export type Recording = { blob: Blob; durationMs: number; type: string };

type Session = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; timer: number };

/**
 * ブラウザでの録音（開始・停止・経過時間・マイクの後始末）。音声を添付する録音（AudioCapture）と、音声入力（VoiceDialog）が使う。
 * 録り終えたら `onRecorded`、マイクが使えない・音が録れなかったときは `onError`（直し方つきの説明）を呼ぶ。
 * `maxMs` を渡すと、その長さに達したところで自動で止めて `onRecorded` を呼ぶ。
 * 部品が消えるときは、録音もマイクも止める（`onRecorded` は呼ばない）。
 */
export function useAudioRecorder(opts: { onRecorded: (recording: Recording) => void; onError: (message: string) => void; maxMs?: number }) {
  const recorderType = useRef(pickRecorderType()).current;
  const canRecord = recorderType !== null && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const session = useRef<Session | null>(null);
  // 呼び出し側の関数は毎回作り直されるので、最新のものを参照する
  const latest = useRef(opts);
  latest.current = opts;

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

  const start = async () => {
    if (!recorderType || session.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      latest.current.onError(microphoneProblem(err));
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType: recorderType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      const s = session.current;
      session.current = null;
      stream.getTracks().forEach((t) => t.stop());
      if (s) window.clearInterval(s.timer);
      setRecording(false);
      const blob = new Blob(chunks, { type: recorderType });
      // MediaRecorder の WebM は長さが入らないことがあるので、測った長さではなく、録っていた時間を使う
      const durationMs = Date.now() - (s?.startedAt ?? Date.now());
      if (blob.size === 0) return latest.current.onError("音声が録れていません。マイクが動いているか確かめて、もう一度録音してください。");
      latest.current.onRecorded({ blob, durationMs, type: recorderType });
    };
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      const max = latest.current.maxMs;
      if (max !== undefined && elapsed >= max) session.current?.recorder.stop();
    }, 250);
    session.current = { recorder, stream, chunks, startedAt, timer };
    setElapsedMs(0);
    setRecording(true);
    recorder.start();
  };

  const stop = () => session.current?.recorder.stop();

  return { canRecord, recording, elapsedMs, start, stop };
}
