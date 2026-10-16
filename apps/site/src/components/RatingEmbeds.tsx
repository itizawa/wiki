import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Rating from "./Rating";

/**
 * 本文の `@rating` の位置（`[data-rating-embed]`。src/lib/markdown.ts が出す空の枠）に、評価の欄を入れる。
 * 本文は HTML の文字として出すので、枠ごとに島を置けない。この島が読み込まれたら枠を探し、それぞれへ評価の欄を描く。
 * 1つのページに何か所あっても、評価の対象は同じこのページ。
 */
export default function RatingEmbeds({ pageId }: { pageId: string }) {
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setSlots([...document.querySelectorAll<HTMLElement>("[data-rating-embed]")]);
  }, []);
  return <>{slots.map((slot, i) => createPortal(<Rating pageId={pageId} />, slot, String(i)))}</>;
}
