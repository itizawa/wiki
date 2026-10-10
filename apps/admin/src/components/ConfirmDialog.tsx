import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useSyncExternalStore } from "react";

export type ConfirmOptions = {
  /** 何を確かめているか（問いかけの形で） */
  title: string;
  /** 実行すると何が起きるか */
  body?: string;
  /** 実行するボタン。「OK」「はい」ではなく、起きることを動詞で書く */
  confirmLabel: string;
  /** やめるボタン。こちらも、押すとどうなるかを書く */
  cancelLabel: string;
  /** 取り返しのつかない操作なら true（実行するボタンを赤にする） */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const listeners = new Set<() => void>();
let current: Pending | null = null;
// 閉じるアニメーションの間も文言を出したままにする
let open = false;
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * 画面内の確認ダイアログを出し、実行するなら true を返す。ブラウザ標準の confirm() の代わりに使う。
 * 画面のどこからでも呼べる（Layout に置いた ConfirmHost が表示する）。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 前の確認が残っていたら、やめた扱いにする
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...options, resolve };
    open = true;
    emit();
  });
}

function settle(ok: boolean) {
  current?.resolve(ok);
  if (current) current = { ...current, resolve: () => {} };
  open = false;
  emit();
}

const snapshot = () => (open ? current : null);
const lastSnapshot = () => current;

export function ConfirmHost() {
  const active = useSyncExternalStore(subscribe, snapshot);
  const shown = useSyncExternalStore(subscribe, lastSnapshot);
  return (
    <Dialog open={active !== null} onClose={() => settle(false)} fullWidth maxWidth="xs" aria-labelledby="confirm-title">
      <DialogTitle id="confirm-title">{shown?.title}</DialogTitle>
      {shown?.body && (
        <DialogContent>
          <DialogContentText>{shown.body}</DialogContentText>
        </DialogContent>
      )}
      {/* 取り返しのつかない操作のボタンは、やめるボタンから離して置く */}
      <DialogActions sx={{ px: 3, pb: 2, gap: shown?.danger ? 1.5 : 0 }}>
        <Button autoFocus={shown?.danger} onClick={() => settle(false)}>
          {shown?.cancelLabel}
        </Button>
        <Button variant="contained" color={shown?.danger ? "error" : "primary"} autoFocus={!shown?.danger} onClick={() => settle(true)}>
          {shown?.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
