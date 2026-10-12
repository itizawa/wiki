import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import { Tooltip } from "./Tooltip";

export type SaveState = "saving" | "saved" | "failed";

/** 下書きの保存の状態。打っている途中・送っている間は saving、保存できていなければ failed、それ以外は saved */
export function saveState(a: { pending: boolean; saving: boolean; error: unknown }): SaveState {
  if (a.error) return "failed";
  return a.pending || a.saving ? "saving" : "saved";
}

/** 「12:34」の形（マウスを乗せたときの説明に使う） */
export function clockTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 保存済みにマウスを乗せたときの説明 */
export function savedHint(savedAt: string | null): string {
  const t = savedAt ? clockTime(savedAt) : null;
  return `${t ? `下書きを ${t} に保存しました。` : "下書きは保存されています。"}版は ⌘S で今すぐ残せます`;
}

const text = { whiteSpace: "nowrap", flexShrink: 0, fontSize: "0.8125rem" } as const;

/**
 * 編集画面の上のバーに出す、本文の下書きの保存の状態。テンプレートの編集画面の「保存中… / 保存済み」と言葉をそろえる。
 * 読み上げで知らせるのは、保存できなかったときだけ（打つたびに鳴らさない）。
 * `onRetry` を渡すと、失敗のときに「もう一度試す」を出す（別の画面で版が進んだ競合は、もう一度試しても直らないので渡さない）。
 */
export function SaveStatus({ state, savedAt, onRetry }: { state: SaveState; savedAt: string | null; onRetry?: () => void }) {
  if (state === "failed") {
    return (
      <Box role="alert" sx={{ ...text, display: "flex", alignItems: "center", gap: 0.5, color: "error.main", fontWeight: 600 }}>
        保存できませんでした
        {onRetry && (
          <ButtonBase
            onClick={onRetry}
            sx={{ ...text, color: "primary.main", textDecoration: "underline", fontWeight: 600, px: 0.5, minHeight: 32, borderRadius: 0.5 }}
          >
            もう一度試す
          </ButtonBase>
        )}
      </Box>
    );
  }
  if (state === "saving") {
    return (
      <Box data-save-state="saving" sx={{ ...text, color: "text.secondary" }}>
        保存中…
      </Box>
    );
  }
  return (
    <Tooltip title={savedHint(savedAt)}>
      <Box data-save-state="saved" sx={{ ...text, color: "text.secondary" }}>
        保存済み
      </Box>
    </Tooltip>
  );
}
