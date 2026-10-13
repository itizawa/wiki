import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import { keyframes } from "@mui/material/styles";
import { themeBackdrop, themeMotion, themePresetFor, themeVariant } from "@wiki/shared";
import { fixedModeOf } from "../theme";

/** そのテーマの背景（いまの端末の設定でのモードの版）。背景の無いテーマは null。画面の面を透明にして背景を見せるかの判断にも使う */
export function useThemeBackdrop(preset: string) {
  const osDark = useMediaQuery("(prefers-color-scheme: dark)");
  return themeBackdrop(themeVariant(themePresetFor(preset), fixedModeOf(preset) ?? (osDark ? "dark" : "light")), null);
}

/**
 * wiki の外観で選んだテーマの背景画像（方眼・水玉・星など）を、画面全体の後ろに固定で敷く。公開サイトの `.theme-backdrop` と同じ画像。
 * 押せず、読み上げず、印刷には出さない。画面の面（サイドバー・カード）は不透明なので、画像が見えるのは何も置いていない余白だけ。
 * 飾り（フクロウ）と、wiki が自分で入れた背景画像は、管理画面には出さない
 */
export function ThemeBackdrop({ preset }: { preset: string }) {
  const backdrop = useThemeBackdrop(preset);
  const motion = useThemeMotion(preset);
  if (!backdrop && !motion) return null;
  return (
    <>
      {backdrop && (
        <Box
          aria-hidden
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: -1,
            pointerEvents: "none",
            backgroundImage: backdrop.image,
            backgroundSize: backdrop.size,
            backgroundRepeat: backdrop.repeat,
            backgroundPosition: "center",
            "@media print": { display: "none" },
          }}
        />
      )}
      {motion && <ThemeMotionLayer motion={motion} />}
    </>
  );
}

function useThemeMotion(preset: string) {
  const osDark = useMediaQuery("(prefers-color-scheme: dark)");
  return themeMotion(themeVariant(themePresetFor(preset), fixedModeOf(preset) ?? (osDark ? "dark" : "light")));
}

// 公開サイトの `.theme-motion`（global.css）と同じ動き。画面の左の外から右上がり 15 度（tan ≒ 0.27）で右の外へ横切り、残りの時間は外で待つ
const fly = (w: number) =>
  keyframes({
    "0%": { transform: "translate3d(0, 0, 0)" },
    "50%, 100%": { transform: `translate3d(calc(100vw + ${2 * w}px), calc(-0.27 * (100vw + ${2 * w}px)), 0)` },
  });

/** 背景の後ろを動くもの（宇宙のロケット）。押せず、読み上げず、印刷と「動きを減らす」設定では出さない */
function ThemeMotionLayer({ motion }: { motion: NonNullable<ReturnType<typeof themeMotion>> }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        zIndex: -1,
        pointerEvents: "none",
        left: -motion.width,
        top: `${motion.top}%`,
        width: motion.width,
        height: motion.height,
        background: `${motion.image} no-repeat center / contain`,
        animation: `${fly(motion.width)} ${motion.duration}s linear 1s infinite`,
        willChange: "transform",
        "@media print, (prefers-reduced-motion: reduce)": { display: "none" },
      }}
    />
  );
}
