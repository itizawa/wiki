import { TableOfContents } from "lucide-react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { currentOutlineIndex, outlineOf, TITLE_INDEX, type OutlineHeading } from "./outlineHeadings";

/** 見出しへ飛んだとき・いまの節を決めるときに空けておく、画面の上の余白（固定したヘッダー 48px ＋少し）。 */
export const OUTLINE_SCROLL_MARGIN = 64;

const sameOutline = (a: OutlineHeading[], b: OutlineHeading[]) =>
  a.length === b.length && a.every((h, i) => h.pos === b[i]!.pos && h.level === b[i]!.level && h.text === b[i]!.text);

/**
 * 本文の見出しの一覧。書くたびに（版の復元などで本文が差し替わったときも）追いかける。
 * 見出しが1つ以上あるときだけ目次を出す（公開サイトと同じ）。目次の先頭にはページのタイトルが付く。
 */
export function useOutline(editor: Editor | null): OutlineHeading[] {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next = outlineOf(editor.state.doc);
      setHeadings((prev) => (sameOutline(prev, next) ? prev : next));
    };
    update();
    editor.on("transaction", update);
    return () => void editor.off("transaction", update);
  }, [editor]);
  return editor && headings.length >= 1 ? headings : [];
}

/** 見出しの要素。閉じたトグルの中にあって見えないときは、そのトグルを返す。 */
function headingElement(editor: Editor, pos: number): HTMLElement | null {
  let el = editor.view.nodeDOM(pos) as HTMLElement | null;
  while (el && el.getClientRects().length === 0) el = el.parentElement?.closest<HTMLElement>("[data-type='details']") ?? null;
  return el;
}

/** 本文をスクロールして、見出しを画面の上に出す。 */
function jumpTo(editor: Editor, pos: number) {
  headingElement(editor, pos)?.scrollIntoView({ block: "start" });
}

/** いま読んでいる節の番号。本文の枠（スクロールする main）を送るたびに見直す。 */
function useCurrentHeading(editor: Editor | null, headings: OutlineHeading[]): number {
  const [current, setCurrent] = useState(TITLE_INDEX);
  useEffect(() => {
    if (!editor || headings.length === 0) {
      setCurrent(TITLE_INDEX);
      return;
    }
    const scroller = editor.view.dom.closest("main");
    let queued = false;
    const update = () => {
      queued = false;
      const tops = headings.map((h) => {
        const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
        return el && el.getClientRects().length > 0 ? el.getBoundingClientRect().top : null;
      });
      const line = (scroller?.getBoundingClientRect().top ?? 0) + OUTLINE_SCROLL_MARGIN;
      const atEnd = !!scroller && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      setCurrent(currentOutlineIndex(tops, line, atEnd));
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    update();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [editor, headings]);
  return current;
}

const outlineLinkSx = {
        display: "block",
        py: 0.375,
        pl: 1.25,
        borderLeft: "2px solid transparent",
        color: "text.secondary",
        textDecoration: "none",
        lineHeight: 1.5,
        overflowWrap: "anywhere",
        "&:hover": { color: "text.primary", textDecoration: "underline" },
        "&[aria-current]": { color: "text.primary", fontWeight: 700, borderLeftColor: "primary.main" },
} as const;

/** 目次の一覧。いちばん浅い見出しを左端に揃え、いま読んでいる節は色・太字・左の線で示す。 */
function OutlineList(props: { editor: Editor; headings: OutlineHeading[]; title: string; onJumpTitle: () => void; current: number; onJump?: () => void }) {
  const minLevel = Math.min(...props.headings.map((h) => h.level));
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
      <Box component="li">
        <Box
          component="a"
          href="#"
          aria-current={props.current === TITLE_INDEX ? "location" : undefined}
          onClick={(e) => {
            e.preventDefault();
            props.onJump?.();
            props.onJumpTitle();
          }}
          sx={outlineLinkSx}
        >
          {props.title}
        </Box>
      </Box>
      {props.headings.map((h, i) => (
        <Box component="li" key={h.pos} sx={{ pl: `${(h.level - minLevel) * 0.875}rem` }}>
          <Box
            component="a"
            href="#"
            aria-current={i === props.current ? "location" : undefined}
            onClick={(e) => {
              e.preventDefault();
              props.onJump?.();
              jumpTo(props.editor, h.pos);
            }}
            sx={outlineLinkSx}
          >
            {h.text}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** 広い画面で、本文の右に固定して出す目次。 */
export function OutlineSide({ editor, headings, title, onJumpTitle }: { editor: Editor; headings: OutlineHeading[]; title: string; onJumpTitle: () => void }) {
  const current = useCurrentHeading(editor, headings);
  const nav = useRef<HTMLElement>(null);
  // 目次が長くて中でスクロールするとき、いまの節が見える位置に来るようにする
  useEffect(() => {
    nav.current?.querySelector("a[aria-current]")?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <Box
      ref={nav}
      component="nav"
      aria-label="目次"
      sx={{
        position: "sticky",
        top: OUTLINE_SCROLL_MARGIN,
        maxHeight: `calc(100vh - ${OUTLINE_SCROLL_MARGIN + 16}px)`,
        overflowY: "auto",
        pl: 2,
        borderLeft: 1,
        borderColor: "divider",
        fontSize: "0.8125rem",
      }}
    >
      <OutlineList editor={editor} headings={headings} title={title} onJumpTitle={onJumpTitle} current={current} />
    </Box>
  );
}

/** ボタンの下に開く目次。見出しを選ぶと閉じる。スマホ幅では「…」メニューから開く。 */
export function OutlinePopover(props: { editor: Editor; headings: OutlineHeading[]; title: string; onJumpTitle: () => void; anchorEl: HTMLElement | null; open: boolean; onClose: () => void }) {
  const current = useCurrentHeading(props.editor, props.headings);
  // タイトルへ移るのは、閉じ終わってから（開いているあいだはフォーカスが目次の中に留められ、閉じるとボタンに戻されるため）
  const toTitle = useRef(false);
  // タイトルへ移るときだけ、フォーカスをボタンへ戻さない。見出しへ移るときは、これまでどおりボタンへ戻す
  const [skipRestore, setSkipRestore] = useState(false);
  useEffect(() => {
    if (props.open) setSkipRestore(false);
  }, [props.open]);
  return (
    <Popover
      open={props.open}
      disableRestoreFocus={skipRestore}
      anchorEl={props.anchorEl}
      onClose={props.onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        transition: {
          onExited: () => {
            if (!toTitle.current) return;
            toTitle.current = false;
            props.onJumpTitle();
          },
        },
        paper: { component: "nav", "aria-label": "目次", sx: { width: 280, maxWidth: "calc(100vw - 32px)", maxHeight: "60vh", p: 1.5, fontSize: "0.875rem" } } as object,
      }}
    >
      <OutlineList editor={props.editor} headings={props.headings} title={props.title} onJumpTitle={() => {
        toTitle.current = true;
        setSkipRestore(true);
      }} current={current} onJump={props.onClose} />
    </Popover>
  );
}

/** 本文の右に目次を置けない幅で、ヘッダーのボタンから開く目次。 */
export function OutlineButton({ editor, headings, title, onJumpTitle }: { editor: Editor; headings: OutlineHeading[]; title: string; onJumpTitle: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="目次">
        <IconButton size="small" aria-label="目次" aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>
          <TableOfContents size={18} />
        </IconButton>
      </Tooltip>
      <OutlinePopover editor={editor} headings={headings} title={title} onJumpTitle={onJumpTitle} anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} />
    </>
  );
}
