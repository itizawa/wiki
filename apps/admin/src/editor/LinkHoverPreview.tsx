import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { HOVER_DELAY_MS, hoverTargetOf, pagePreview, type HoverPreview, type HoverTarget } from "./linkHover";

type Hovered = { target: HoverTarget; rect: DOMRect };

/** 本文のリンクの先を調べて、プレビューにする。取れなければ null（出さない）。 */
function useHoverPreview(target: HoverTarget | null): HoverPreview | null {
  const page = useQuery({
    queryKey: ["page", target?.kind === "page" ? target.id : ""],
    queryFn: () => api.getPage((target as { id: string }).id),
    staleTime: 30_000,
    enabled: target?.kind === "page",
    retry: false,
  });
  const external = useQuery({
    queryKey: ["link-preview", target?.kind === "external" ? target.url : ""],
    queryFn: async () => (await api.linkPreview((target as { url: string }).url)).preview,
    staleTime: 10 * 60_000,
    enabled: target?.kind === "external",
    retry: false,
  });
  if (target?.kind === "page" && page.data) return pagePreview(page.data);
  if (target?.kind === "external" && external.data) {
    return { title: external.data.title, text: external.data.description, site: external.data.siteName ?? new URL(target.url).hostname };
  }
  return null;
}

/**
 * 本文のリンクにカーソルを載せると、リンク先のプレビュー（内部リンクはタイトル・アイコン・抜粋、外部リンクは OGP）を出す。
 * 編集の邪魔にならないよう、出すのはマウスのホバーだけ（HOVER_DELAY_MS 待つ）。押す・キーを打つ・スクロール・Esc・外すで閉じる。
 * カードのノード（`.link-card`）の中と、ホバーできない端末（タッチ）では出さない。画像は出さない（公開サイトと同じ）。
 */
export function LinkHoverPreview({ editor }: { editor: Editor }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      setHovered(null);
    };
    const linkOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null);
    const onOver = (e: MouseEvent) => {
      const link = linkOf(e);
      if (!link || !dom.contains(link) || link.closest(".link-card") || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const target = hoverTargetOf(link.getAttribute("href") ?? "");
      if (!target) return;
      clearTimeout(timer);
      const rects = [...link.getClientRects()];
      const rect = rects.find((r) => e.clientY >= r.top && e.clientY <= r.bottom) ?? rects[0] ?? link.getBoundingClientRect();
      timer = setTimeout(() => setHovered({ target, rect }), HOVER_DELAY_MS);
    };
    const onOut = (e: MouseEvent) => {
      const link = linkOf(e);
      if (link && !link.contains(e.relatedTarget as Node | null)) hide();
    };
    const onKey = hide;
    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    dom.addEventListener("mousedown", hide);
    dom.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
      dom.removeEventListener("mousedown", hide);
      dom.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, [editor]);

  // Esc は、エディタにフォーカスが無いときも閉じる
  useEffect(() => {
    if (!hovered) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setHovered(null);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [hovered]);

  const preview = useHoverPreview(hovered?.target ?? null);
  if (!hovered || !preview) return null;
  const anchor = { getBoundingClientRect: () => hovered.rect };
  return (
    <Popper open anchorEl={anchor} placement="bottom-start" modifiers={[{ name: "offset", options: { offset: [0, 6] } }]} sx={{ zIndex: "tooltip", pointerEvents: "none" }}>
      <Paper role="tooltip" elevation={4} sx={{ width: 360, maxWidth: "calc(100vw - 16px)", px: 1.5, py: 1, display: "flex", flexDirection: "column", gap: 0.25 }}>
        {preview.site && (
          <Typography variant="caption" color="text.secondary">
            {preview.site}
          </Typography>
        )}
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {preview.icon && <span aria-hidden="true">{preview.icon} </span>}
          {preview.title}
        </Typography>
        {preview.text && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {preview.text}
          </Typography>
        )}
      </Paper>
    </Popper>
  );
}
