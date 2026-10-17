import { useEffect, useRef, useState } from "react";

/** 横にスクロールできる帯の、左右にまだ続きがあるか（1px 未満の端数は無視する） */
export function scrollEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  return { start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
}

/** 続きがある側の端を薄くぼかす（mask-image）。続きが無ければ、ぼかさない */
export function edgeFadeMask(edges: { start: boolean; end: boolean }, size = 24): string | undefined {
  if (!edges.start && !edges.end) return undefined;
  const left = edges.start ? `transparent 0, #000 ${size}px` : "#000 0";
  const right = edges.end ? `#000 calc(100% - ${size}px), transparent 100%` : "#000 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
}

/** マウスのホイール（縦）の量を、横のスクロールに回すか。はみ出していないとき、横の量があるとき（トラックパッドの横送り）は回さない */
export function wheelToSideways(el: { scrollWidth: number; clientWidth: number }, e: { deltaX: number; deltaY: number }): number | null {
  if (el.scrollWidth <= el.clientWidth || e.deltaX !== 0 || e.deltaY === 0) return null;
  return e.deltaY;
}

/**
 * 横にスクロールする帯（書式のツールバー）。続きがある側の端をぼかし、ホイールの縦の回転でも横に送る。
 * 横に送っている間は、ページは一緒にスクロールさせない（React の onWheel は passive で止められないので、自分で付ける）
 */
export function useSideScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges((prev) => {
        const next = scrollEdges(el);
        return prev.start === next.start && prev.end === next.end ? prev : next;
      });
    const onWheel = (e: WheelEvent) => {
      const dx = wheelToSideways(el, e);
      if (dx === null) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);
  return { ref, mask: edgeFadeMask(edges) };
}
