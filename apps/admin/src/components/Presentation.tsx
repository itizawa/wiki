import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import useMediaQuery from "@mui/material/useMediaQuery";
import { Editor, EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { editorExtensions } from "../editor/extensions";
import { editorContentSx } from "../editor/MarkdownEditor";
import { presentationSlides, type Slide } from "../lib/slides";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

/** 1枚に収まらないスライドを縮める下限。ここまで縮めても収まらなければ、スライドの中で縦にスクロールする */
const MIN_SCALE = 0.5;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** 本文の末尾にある、何も書いていない段落 */
const TRAILING_LINE = "p:last-child:has(> br.ProseMirror-trailingBreak:only-child)";

/** スライドを、エディタの何倍の大きさで出すか。画面の幅に合わせて 1.15〜2 倍（公開サイトのプレゼンモードの文字の大きさと同じ式） */
const baseScale = () => Math.min(2, Math.max(1.15, 0.8 + (window.innerWidth * 0.015) / 16));

const exitFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
};

/** 本文（Markdown）を、エディタと同じ読み方でブロックの並びにする。トグルは閉じた状態になる（開閉は Markdown に書かないため） */
function parseBlocks(bodyMd: string): JSONContent[] {
  const parser = new Editor({ element: null, extensions: editorExtensions, editable: false, content: bodyMd, contentType: "markdown" });
  const blocks = parser.getJSON().content ?? [];
  parser.destroy();
  return blocks;
}

/** スライド1枚ぶんの文書。タイトルのスライドは本文を出さないので、空にしておく */
const docOf = (slide: Slide<JSONContent> | undefined): JSONContent => ({
  type: "doc",
  content: slide?.kind === "body" ? slide.blocks : [{ type: "paragraph" }],
});

/**
 * プレゼンモード。ページを見出しと区切り線でスライドに分け（lib/slides.ts）、画面全体を覆って1枚ずつ出す。
 * 出すのは、開いたときに画面にあった内容（版になる前の変更も含む）。URL は変えない。
 * 分け方とキー操作は、公開サイトのプレゼンモード（apps/site の Article.astro）と揃える。
 */
export function Presentation(props: { open: boolean; title: string; bodyMd: string; onClose: () => void; onExited: () => void }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  // 終了したら、全画面も解く
  const close = () => {
    exitFullscreen();
    props.onClose();
  };
  return (
    <Dialog
      fullScreen
      open={props.open}
      onClose={(_, reason) => {
        // Esc は、全画面ならそれをやめるだけにする（ブラウザが先に全画面を解かない環境でも、同じ動きにする）
        if (reason === "escapeKeyDown" && document.fullscreenElement) exitFullscreen();
        else close();
      }}
      // フォーカスの戻り先は、呼んだ側が決める（メニューから開くので、開く前のフォーカスは当てにならない）
      disableRestoreFocus
      transitionDuration={reducedMotion ? 0 : undefined}
      slotProps={{ paper: { elevation: 0, "aria-label": "プレゼンモード" }, transition: { onExited: props.onExited } }}
    >
      <Slides title={props.title} bodyMd={props.bodyMd} onExit={close} />
    </Dialog>
  );
}

function Slides(props: { title: string; bodyMd: string; onExit: () => void }) {
  // 開いたときの内容で作る。プレゼン中は変えない
  const [slides] = useState(() => presentationSlides(props.title, parseBlocks(props.bodyMd)));
  const [index, setIndex] = useState(0);
  const last = slides.length - 1;
  const slide = slides[index];
  /** 番号を、ある範囲に収めて移る */
  const go = (to: (current: number) => number) => setIndex((current) => Math.max(0, Math.min(last, to(current))));

  // 本文のスライドは、エディタと同じ拡張の読み取り専用の Tiptap で出す（コードの色分け・トグル・チェックリストがエディタと同じになる）
  const editor = useEditor({ extensions: editorExtensions, editable: false, content: docOf(slides[0]) });

  const stage = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  /** スライドが1枚に収まるまで、全体を縮める（MIN_SCALE まで） */
  const fit = () => {
    const stageEl = stage.current;
    const sheetEl = sheet.current;
    if (!stageEl || !sheetEl) return;
    const base = baseScale();
    const fits = () => stageEl.scrollHeight <= stageEl.clientHeight + 1 && stageEl.scrollWidth <= stageEl.clientWidth + 1;
    // zoom は幅の上限も縮めるので、CSS の側で倍率で割り戻す（縮めたスライドの横が空かないよう、1行を長くする）
    const scale = (value: number) => {
      sheetEl.style.setProperty("zoom", String(base * value));
      sheetEl.style.setProperty("--slide-zoom", String(base * value));
      sheetEl.style.setProperty("--slide-shrink", String(value));
    };
    scale(1);
    if (fits()) return;
    // 縮めると行の折り返しも変わるので、収まるいちばん大きい倍率を二分探索で探す
    let low = MIN_SCALE;
    let high = 1;
    for (let i = 0; i < 6; i++) {
      const middle = (low + high) / 2;
      scale(middle);
      if (fits()) low = middle;
      else high = middle;
    }
    scale(low);
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const mounted = useRef(false);
  useLayoutEffect(() => {
    editor.commands.setContent(docOf(slide), { emitUpdate: false });
    if (stage.current) stage.current.scrollTop = 0;
    fitRef.current();
    // 無効になったボタンにフォーカスが残ると、キー操作が届かなくなるので、スライドへ移す
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && focused.disabled) stage.current?.focus({ preventScroll: true });
    // 切り替えを短いフェードでつなぐ（動きを減らす設定のときは付けない。開いたときは、オーバーレイごとフェードする）
    if (mounted.current && !window.matchMedia(REDUCED_MOTION).matches) {
      sheet.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    }
    mounted.current = true;
    // slide は index で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, index]);

  // 画面の大きさが変わったとき（全画面の出入りを含む）と、中身の大きさが変わったとき（トグルを開いた、画像を読み込み終えた）に、収め直す
  useEffect(() => {
    const observer = new ResizeObserver(() => fitRef.current());
    if (stage.current) observer.observe(stage.current);
    if (sheet.current) observer.observe(sheet.current);
    return () => observer.disconnect();
  }, []);

  // Fullscreen API が使えない環境（iPhone の Safari など）では、全画面表示のボタンを出さない
  const canFullscreen = document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (!canFullscreen) return;
    // オーバーレイではなく、ページごと全画面にする（オーバーレイは、その上に出たまま）。断られても、プレゼンはそのまま続ける
    if (document.fullscreenElement) exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  const keys = useRef({ go, toggleFullscreen, last });
  keys.current = { go, toggleFullscreen, last };
  useEffect(() => {
    // ほかのキー操作より先に受ける（capture）。下のエディタにも、管理画面のショートカット（「?」のガイド・⌘K・⌘S など）にも届けない
    const onKey = (e: KeyboardEvent) => {
      // Esc（終了）と Tab（フォーカスの移動）は、オーバーレイに任せる
      if (e.key === "Escape" || e.key === "Tab") return;
      e.stopPropagation();
      if (e.altKey || e.ctrlKey || e.metaKey) {
        // 管理画面が受けていた ⌘K・⌘S は、ブラウザの動き（ページの保存など）にも渡さない。⌘F などのブラウザの操作は奪わない
        if (["k", "s"].includes(e.key.toLowerCase()) && !e.altKey) e.preventDefault();
        return;
      }
      const { go, toggleFullscreen, last } = keys.current;
      // ボタン・リンクにフォーカスがあるときの Space は、その部品の操作にする
      const onControl = e.target instanceof Element && e.target.closest("button, a, summary") !== null;
      if (e.key === " " && !onControl) go((i) => i + 1);
      else if (e.key === "ArrowRight" || e.key === "PageDown") go((i) => i + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go((i) => i - 1);
      else if (e.key === "Home") go(() => 0);
      else if (e.key === "End") go(() => last);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // 最初のフォーカスはスライドに置く（ボタンに置くと、Space でそのボタンが押されてしまう）
  useEffect(() => stage.current?.focus({ preventScroll: true }), []);

  // マウスで押したボタンにフォーカスを残さない（次に Space を押したとき、そのボタンがもう一度押されてしまうため）
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const barSx = { flex: "none", display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1 };
  const buttonSx = { minWidth: 44, minHeight: 44, px: 1.75, fontSize: "0.9rem" };
  const arrowSx = { width: 44, height: 44, border: 1, borderColor: "divider", borderRadius: 1 };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", overscrollBehavior: "contain" }}>
      {/* 操作部品は、いつも見える位置に置く。上に「全画面表示」「終了」、下にスライド送り（終了は、スライド送りから離す） */}
      <Box sx={{ ...barSx, justifyContent: "flex-end" }} onMouseDown={keepFocus}>
        {canFullscreen && (
          <Tooltip title={fullscreen ? "全画面表示をやめる (F)" : "全画面表示 (F)"}>
            <Button variant="outlined" color="inherit" startIcon={fullscreen ? <Minimize size={18} /> : <Maximize size={18} />} onClick={toggleFullscreen} sx={buttonSx}>
              {fullscreen ? "全画面表示をやめる" : "全画面表示"}
            </Button>
          </Tooltip>
        )}
        {/* 全画面のあいだの Esc は、全画面をやめるだけ */}
        <Tooltip title={fullscreen ? "プレゼンモードを終了" : "プレゼンモードを終了 (Esc)"}>
          <Button variant="outlined" color="inherit" startIcon={<X size={18} />} onClick={props.onExit} sx={{ ...buttonSx, fontWeight: 600 }}>
            プレゼンモードを終了
          </Button>
        </Tooltip>
      </Box>

      {/* スライドを置く場所。収まるスライドは中央に置き、収まらないスライドは上から読めるようにスクロールさせる（margin: auto） */}
      <Box ref={stage} tabIndex={-1} sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "auto", px: { xs: 2, sm: 3 }, py: 1, outline: "none" }}>
        <Box
          ref={sheet}
          sx={{
            m: "auto",
            width: "100%",
            maxWidth: "calc(34rem / var(--slide-shrink, 1))",
            overflowWrap: "anywhere",
            "& .tiptap": {
              ...editorContentSx,
              outline: "none",
              "& > :last-child": { mb: 0 },
              // エディタが末尾に足す空の行（続きを書くためのもの）は、スライドでは出さない
              [`& > ${TRAILING_LINE}`]: { display: "none" },
              [`& > :has(+ ${TRAILING_LINE})`]: { mb: 0 },
              // リンクは新しいタブで開く。開く先が別のタブだと分かるよう、印を付ける
              "& a": { color: "primary.main", cursor: "pointer", "&::after": { content: '"↗"', ml: "0.15em", fontSize: "0.75em" } },
              // チェックリストは、押しても変わらない
              "& ul[data-type='taskList'] li > label": { mt: "0.35em", flexShrink: 0, pointerEvents: "none" },
              // 縦に長い画像で、スライドが縮みすぎないようにする（zoom の倍率で割り戻して、画面の高さの6割まで）
              "& img": { maxWidth: "100%", maxHeight: "calc(60vh / var(--slide-zoom, 1))", borderRadius: 1 },
            },
          }}
        >
          {slides.length === 0 && <Muted sx={{ textAlign: "center" }}>スライドにする内容がありません。タイトルか本文を書くと、ここに出ます。</Muted>}
          {slide?.kind === "title" && (
            <Box component="h1" sx={{ m: 0, textAlign: "center", fontSize: "2rem", fontWeight: 700, lineHeight: 1.35 }}>
              {slide.title}
            </Box>
          )}
          <Box sx={{ display: slide?.kind === "body" ? "block" : "none" }}>
            <EditorContent editor={editor} />
          </Box>
        </Box>
      </Box>

      {slides.length > 0 && (
        <Box sx={{ ...barSx, justifyContent: "center" }} onMouseDown={keepFocus}>
          <Tooltip title="前のスライド (←)" placement="top">
            <span>
              <IconButton aria-label="前のスライド" disabled={index === 0} onClick={() => go((i) => i - 1)} sx={arrowSx}>
                <ChevronLeft size={22} />
              </IconButton>
            </span>
          </Tooltip>
          <Box component="span" aria-live="polite" sx={{ minWidth: "5em", textAlign: "center", fontSize: "0.9rem", fontVariantNumeric: "tabular-nums" }}>
            {index + 1} / {slides.length}
          </Box>
          <Tooltip title="次のスライド (→)" placement="top">
            <span>
              <IconButton aria-label="次のスライド" disabled={index === last} onClick={() => go((i) => i + 1)} sx={arrowSx}>
                <ChevronRight size={22} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
