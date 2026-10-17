import { useEffect, useRef, type ReactNode } from "react";
import Tabs from "@mui/material/Tabs";
import type { SxProps, Theme } from "@mui/material/styles";

type Span = { left: number; right: number };

/**
 * 横に送れる帯（`frame`）の中で、`item` が見えるようにするための `scrollLeft` を返す。
 * もう全部見えているなら、いまの値のまま（動かさない）。はみ出しているなら、帯の真ん中へ送る。
 * 端に合わせるだけだと、送ったあとに反対側の矢印が出て帯が狭まり、またはみ出す。真ん中なら、矢印1つ分の余りが両側に残る。
 * 送れる範囲の外になる値（先頭・末尾のタブ）は、ブラウザが端に収める。
 */
export function scrollLeftToReveal(scrollLeft: number, frame: Span, item: Span): number {
  if (item.left >= frame.left && item.right <= frame.right) return scrollLeft;
  return scrollLeft + (item.left + item.right) / 2 - (frame.left + frame.right) / 2;
}

/** 選ばれたタブを、帯の見える範囲へ送る */
function revealSelectedTab(root: HTMLElement | null) {
  const scroller = root?.querySelector<HTMLElement>(".MuiTabs-scroller");
  const tab = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!scroller || !tab) return;
  const next = scrollLeftToReveal(scroller.scrollLeft, scroller.getBoundingClientRect(), tab.getBoundingClientRect());
  if (next !== scroller.scrollLeft) scroller.scrollLeft = next;
}

/**
 * 画面を切り替えるタブの帯（wiki の設定・全体の管理）。タブはリンク（`createLink(Tab)`）で渡す。
 * 狭い幅では横に送れ、両端に矢印を出す（タッチの端末でも出す）。開いたとき・タブが変わったときは、選ばれたタブを見える範囲へ送る。
 */
export function NavTabs({ value, "aria-label": ariaLabel, sx, children }: { value: string | false; "aria-label": string; sx?: SxProps<Theme>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // MUI の自動の送りは、開いた直後（矢印が出る前の幅で測る）やアプリの中で移ったときに、外れることがある。
  // 矢印が出たあとの幅で測るよう、次の描画でも送り直す。
  // `scrollIntoView` は使わない：ページ全体も縦に動くうえ、Chrome は Tab で次に動く起点をそのタブに置いてしまう（Sidebar の行と同じ理由）
  useEffect(() => {
    revealSelectedTab(ref.current);
    const id = requestAnimationFrame(() => revealSelectedTab(ref.current));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <Tabs
      ref={ref}
      value={value}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label={ariaLabel}
      // 端まで送り切ったときの矢印は、見えないまま幅だけ取ってしまう（端に空きができる）ので、幅ごと畳む
      sx={[{ "& .MuiTabScrollButton-root.Mui-disabled": { width: 0 } }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Tabs>
  );
}
