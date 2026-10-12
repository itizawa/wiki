import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import { themeBackdrop, themePresetFor, themeVariant } from "@wiki/shared";
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
  if (!backdrop) return null;
  return (
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
  );
}
