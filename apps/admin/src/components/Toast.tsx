import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import { useSyncExternalStore } from "react";
import { errorMessage } from "../lib/api";

export type ToastOptions = {
  /** 何が起きたか。「〜をゴミ箱に入れました」のように、結果を書く */
  message: string;
  /** 付けると「元に戻す」が出る。押すと呼ばれ、戻した結果の知らせ（文字列）を返せる */
  undo?: () => Promise<string | void>;
};

type Current = ToastOptions & { id: number };

const listeners = new Set<() => void>();
let current: Current | null = null;
// 閉じるアニメーションの間も文言を出したままにする
let open = false;
let seq = 0;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const TOAST_MS = 4000;
/** 「元に戻す」がある知らせは、押す間を取るために長く出す。 */
const UNDO_TOAST_MS = 10000;

/**
 * 操作の結果を画面の下に知らせる。確認ダイアログを挟まずに実行した操作に、「元に戻す」を付けて使う。
 * 画面のどこからでも呼べる（Layout に置いた `ToastHost` が表示する）。新しい知らせは、前の知らせに置き換わる。
 */
export function showToast(options: ToastOptions) {
  current = { ...options, id: ++seq };
  open = true;
  emit();
}

function close() {
  open = false;
  emit();
}

async function runUndo(toast: Current) {
  close();
  try {
    const message = await toast.undo?.();
    showToast({ message: message || "元に戻しました" });
  } catch (err) {
    showToast({ message: `元に戻せませんでした：${errorMessage(err)}` });
  }
}

const snapshot = () => (open ? current : null);
const lastSnapshot = () => current;

export function ToastHost() {
  const active = useSyncExternalStore(subscribe, snapshot);
  const shown = useSyncExternalStore(subscribe, lastSnapshot);
  return (
    <Snackbar
      key={shown?.id}
      open={active !== null}
      message={shown?.message}
      autoHideDuration={shown?.undo ? UNDO_TOAST_MS : TOAST_MS}
      onClose={(_e, reason) => {
        // 画面の別の場所を押しただけでは閉じない（「元に戻す」を押す前に消えないように）
        if (reason !== "clickaway") close();
      }}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      action={
        shown?.undo && (
          <Button color="inherit" size="small" onClick={() => void runUndo(shown)}>
            元に戻す
          </Button>
        )
      }
    />
  );
}
