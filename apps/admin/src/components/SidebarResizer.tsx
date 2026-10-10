import Box from "@mui/material/Box";
import { useRef } from "react";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;
const KEY_STEP = 16;

export const clampSidebarWidth = (width: number) => Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));

/**
 * サイドバーの右端にある、幅を変えるつまみ。ドラッグか、フォーカスして ←→ で動かす。ダブルクリックで元の幅に戻す。
 * 幅は親が持つ（`value` はいまの幅、`onChange` で新しい幅を返す）。
 */
export function SidebarResizer(props: { value: number; defaultValue: number; onChange: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="サイドバーの幅"
      aria-valuenow={props.value}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="ドラッグで幅を変える（ダブルクリックで元に戻す）"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: props.value };
      }}
      onPointerMove={(e) => {
        if (drag.current) props.onChange(clampSidebarWidth(drag.current.startWidth + e.clientX - drag.current.startX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => props.onChange(props.defaultValue)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        props.onChange(clampSidebarWidth(props.value + (e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP)));
      }}
      sx={{
        position: "absolute",
        zIndex: 3,
        top: 0,
        bottom: 0,
        // 境界線をまたぐ 9px を掴めるようにする（見た目より広く取る）
        left: props.value - 4,
        width: 9,
        cursor: "col-resize",
        touchAction: "none",
        outline: "none",
        "&::after": { content: '""', position: "absolute", top: 0, bottom: 0, left: 3, width: 3, bgcolor: "primary.main", opacity: 0, transition: "opacity 120ms" },
        "&:hover::after, &:active::after, &:focus-visible::after": { opacity: 1 },
      }}
    />
  );
}
