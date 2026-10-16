import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { draftPayload } from "../lib/titleLimit";

export type DraftContent = { title: string; bodyMd: string };

export const sameContent = (a: DraftContent, b: DraftContent) => a.title === b.title && a.bodyMd === b.bodyMd;

/** 打つのが止まってから下書きを保存するまで */
const AUTOSAVE_DELAY_MS = 1500;
/** 通信の失敗などで保存できなかったときに、もう一度試すまで */
const RETRY_DELAY_MS = 5000;

/**
 * 編集中の内容を、下書きとしてサーバーに自動保存する（版は作らない。編集が一段落すると、ワーカーが下書きを版にする）。
 * 打つのが止まったら保存し、保存中に打った分は保存が終わってから続けて保存する。
 * 別の画面で版が先に進んでいた（409）ときは、読み直すまで保存しない。
 * タイトルが上限を超えているあいだは、タイトルを除いて本文だけを保存する（タイトルを直すまで、タイトルの変更は保存されない）。
 * 自分の下書きからワーカーが版を作っていたときは、保存の返事でいまの head が分かるので `onHeadMoved` で知らせる。
 */
export function useDraftAutosave(
  pageId: string,
  content: DraftContent | null,
  baseVersionId: string | null,
  paused: boolean,
  onHeadMoved: (headVersionId: string) => void,
  onSaved?: () => void,
) {
  // サーバーに置いてある内容（下書き、無ければ head）。これと違えば、まだ保存していない
  const synced = useRef<DraftContent | null>(null);
  const [syncedState, setSyncedState] = useState<DraftContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ content, baseVersionId });
  latest.current = { content, baseVersionId };
  const headMoved = useRef(onHeadMoved);
  headMoved.current = onHeadMoved;
  const saved = useRef(onSaved);
  saved.current = onSaved;

  const markSynced = useCallback((c: DraftContent, at: string | null = null) => {
    synced.current = c;
    setSyncedState(c);
    setSavedAt(at);
    setError(null);
  }, []);

  /** まだ保存していない分をいま保存する。保存できた（保存するものが無かった）ら true。 */
  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const { content, baseVersionId } = latest.current;
    if (!content || !baseVersionId || !synced.current) return true;
    // タイトルが上限を超えていたら、タイトルは送らず本文だけ保存する（本文の下書きを止めない）
    const payload = draftPayload(content, synced.current.title);
    if (sameContent(payload, synced.current)) return true;
    const run = (async () => {
      setSaving(true);
      try {
        const res = await api.saveDraft(pageId, { baseVersionId, ...payload });
        markSynced(payload, res.draft?.updatedAt ?? null);
        if (res.headVersionId !== baseVersionId) headMoved.current(res.headVersionId);
        saved.current?.();
        return true;
      } catch (e) {
        setError(e);
        return false;
      } finally {
        setSaving(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [pageId, markSynced]);

  /** 保存中の下書きがあれば、終わるのを待つ（版を作る前に、古い下書きが後から届かないように）。 */
  const settle = useCallback(async () => {
    await inflight.current;
  }, []);

  /** 保存の失敗（別の画面で版が先に進んでいた、など）を片付けて、自動保存を再開する。手元の内容は、まだ保存していないものとして残る */
  const resume = useCallback(() => setError(null), []);

  const pending = content !== null && syncedState !== null && !sameContent(content, syncedState);
  const conflict = error instanceof ApiError && error.status === 409;

  useEffect(() => {
    if (!pending || paused || saving || conflict) return;
    const timer = setTimeout(() => void flush(), error ? RETRY_DELAY_MS : AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, pending, paused, saving, conflict, error, flush]);

  return { pending, saving, savedAt, error, conflict, markSynced, flush, settle, resume };
}
