import { Menu } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CommandMenu } from "../components/CommandMenu";
import { ConfirmHost } from "../components/ConfirmDialog";
import { NotificationBell } from "../components/NotificationBell";
import { ToastHost } from "../components/Toast";
import { ShortcutGuide } from "../components/ShortcutGuide";
import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar";
import { clampSidebarWidth, SidebarResizer } from "../components/SidebarResizer";
import { Tooltip } from "../components/Tooltip";
import { Muted, RouterLink, Section } from "../components/ui";
import { errorMessage, setApiWiki } from "../lib/api";
import { useMigrateLegacyStars, useStarsError } from "../lib/stars";
import { hasOpenOverlay, PEEK_CLOSE_DELAY_MS, PEEK_OPEN_DELAY_MS, shouldHoldPeek } from "../lib/sidebarPeek";
import { usePersistentState } from "../lib/storage";
import { useTabIcon } from "../lib/tabIcon";
import { scrollingBackdropSx, useThemeBackdrop } from "../components/ThemeBackdrop";
import { useAdminThemeFor, useAdminThemePreset } from "../lib/adminTheme";
import { rememberWiki, useWiki, WikiContext } from "../lib/wiki";
import { TOUCH } from "../theme";
import { Center, Loading, mainProps, mainSx, SkipLink, useSession, useWikis } from "./Layout";

/** 閉じたサイドバーの幅（開くボタンだけが残る）。 */
const COLLAPSED_WIDTH = 44;
/** 狭い画面で上に置く帯（メニューを開くボタンと wiki の名前）の高さ。 */
export const NARROW_BAR_HEIGHT = 44;
/** 本文の枠いっぱいの高さ（狭い画面では、上の帯のぶんを引く）。画面いっぱいを使う編集系の画面が使う。 */
export const FULL_HEIGHT = { xs: `calc(100vh - ${NARROW_BAR_HEIGHT}px)`, md: "100vh" } as const;
/** 狭い画面の上の帯の右端（画面ごとの操作を置く場所）。帯が無い広い画面では null。 */
const NarrowBarSlot = createContext<HTMLElement | null>(null);

/** 狭い画面の上の帯の右端に、画面ごとの操作を出す。帯が無い（広い画面の）ときは何も出さない。 */
export function NarrowBarActions({ children }: { children: ReactNode }) {
  const slot = useContext(NarrowBarSlot);
  return slot ? createPortal(children, slot) : null;
}

/** 開閉の動きの長さ。短くして、操作を待たせない。 */
const MOTION_MS = 180;
/** OS の「視差効果を減らす」が有効なら、動かさずにすぐ切り替える。 */
const noMotion = { "@media (prefers-reduced-motion: reduce)": { transition: "none" } } as const;

/**
 * `/w/{key}/...`：1つの wiki を開いている画面。サイドバーと、その wiki の内容を出す。
 * 読み込んだデータ（ページ・ツリー・予約）は wiki ごとの入れ物に持ち、切り替えても別の wiki のものが出ないようにする。
 */
export function WikiLayout({ wikiKey }: { wikiKey: string }) {
  // 子の画面が API を呼ぶ前に、どの wiki の経路を使うかを決める
  setApiWiki(wikiKey);
  const session = useSession();
  const wikis = useWikis();
  const outer = useQueryClient();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: outer.getDefaultOptions() }));
  const active = useMemo(() => (wikis.data?.wikis ?? []).filter((w) => w.archivedAt === null), [wikis.data]);
  const wiki = active.find((w) => w.key === wikiKey);

  useEffect(() => {
    if (wiki) rememberWiki(wiki.key);
  }, [wiki]);

  // タブのアイコンを、開いている wiki のファビコンにする（未設定・wiki の外では既定のまま）
  useTabIcon(wiki?.faviconUrl);
  // 配色を、開いている wiki の外観のテーマにする
  useAdminThemeFor(wikiKey, wiki?.themePreset);

  if (wikis.isPending) return <Loading />;
  if (!wiki) {
    return (
      <Center>
        <Section sx={{ maxWidth: 420, textAlign: "center" }}>
          <Stack spacing={1.5}>
            <Typography variant="h5" component="h1">
              この wiki は開けません
            </Typography>
            <Muted>「{wikiKey}」という wiki は見つかりません。アーカイブされたか、URL が違います。</Muted>
            <RouterLink to="/">ほかの wiki を開く</RouterLink>
          </Stack>
        </Section>
      </Center>
    );
  }

  return (
    <WikiContext.Provider
      value={{ wiki, wikis: active, isOwner: session.isOwner, role: wiki.role, refreshWikis: () => outer.invalidateQueries({ queryKey: ["wikis"] }) }}
    >
      <QueryClientProvider client={queryClient}>
        <Shell email={session.email} name={session.name} pictureUrl={session.pictureUrl} onLogout={session.logout} />
      </QueryClientProvider>
    </WikiContext.Provider>
  );
}

/**
 * 閉じたサイドバーを、左端にマウスを乗せたときだけ本文に重ねて出す（本文の幅は動かさない）。
 * 開いた状態は覚えている `open` とは別に持つ。マウスで操作する端末の広い画面だけで働く。
 * 閉じるのは、マウスが出て少し待ったあと。ドラッグ中・メニューが開いている間・フォーカスがサイドバーの中にある間は閉じない。
 */
function useSidebarPeek(enabled: boolean) {
  const [peek, setPeek] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inside = useRef(false);
  const pressed = useRef(false);

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const scheduleClose = () => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const hold = shouldHoldPeek({
        pointerInside: inside.current,
        pressed: pressed.current,
        overlayOpen: hasOpenOverlay(),
        // キーボードで入れたフォーカスだけを数える（マウスで押したボタンに残ったフォーカスで、開きっぱなしにならないように）
        focusInside: !!document.activeElement && !!ref.current?.contains(document.activeElement) && document.activeElement.matches(":focus-visible"),
      });
      // 閉じない理由があるときは、そのまま待つ。理由が無くなったあとの操作（マウスの移動・フォーカスが外れる）で、また数える
      if (!hold) setPeek(false);
    }, PEEK_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!enabled) {
      clear();
      setPeek(false);
    }
    return clear;
  }, [enabled]);

  // 出している間だけ、サイドバーの外での操作を見る（メニューを閉じたあとの、マウスの動きなど）
  useEffect(() => {
    if (!peek) return;
    const onMove = (e: PointerEvent) => {
      // React のイベントは、画面の末尾に置いたメニューの背景の上でも「サイドバーの中」とみなす。実際の DOM で見直す
      inside.current = e.target instanceof Node && !!ref.current?.contains(e.target);
      if (!inside.current && timer.current === undefined) scheduleClose();
    };
    const onDown = () => {
      pressed.current = true;
    };
    const onUp = () => {
      pressed.current = false;
      if (!inside.current) scheduleClose();
    };
    const onFocusOut = () => {
      if (!inside.current) scheduleClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasOpenOverlay()) {
        clear();
        setPeek(false);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      pressed.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  return {
    peek,
    ref,
    close: () => {
      clear();
      setPeek(false);
    },
    handlers: {
      onPointerEnter: (e: { pointerType: string }) => {
        if (!enabled || e.pointerType !== "mouse") return;
        inside.current = true;
        clear();
        if (!peek) timer.current = setTimeout(() => setPeek(true), PEEK_OPEN_DELAY_MS);
      },
      onPointerLeave: () => {
        inside.current = false;
        if (peek) scheduleClose();
        else clear();
      },
    },
  };
}

function Shell({ email, name, pictureUrl, onLogout }: { email: string; name: string | null; pictureUrl: string | null; onLogout: () => void }) {
  const { wiki } = useWiki();
  const backdrop = useThemeBackdrop(useAdminThemePreset());
  const [sidebarWidth, setSidebarWidth] = usePersistentState("wiki.sidebar.width", SIDEBAR_WIDTH);
  const wide = useMediaQuery((t) => t.breakpoints.up("md"));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [open, setOpenState] = usePersistentState("wiki.sidebar.open", true);
  // 閉じているとき、左端にマウスを乗せると重ねて出す（指で操作する端末・狭い画面は今までどおり）
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const sidebarPeek = useSidebarPeek(wide && canHover && !open);
  const peek = sidebarPeek.peek && !open;
  // 幅を動かすのは開閉のときだけ（つまみで幅を変えている間も動かすと、つまみに遅れて付いてくる）
  const [toggling, setToggling] = useState(false);
  const setOpen = (next: boolean) => {
    setToggling(true);
    setOpenState(next);
  };
  useEffect(() => {
    if (!toggling) return;
    const timer = setTimeout(() => setToggling(false), MOTION_MS + 50);
    return () => clearTimeout(timer);
  }, [toggling, open]);

  // ⌘. / Ctrl+. でサイドバーを開閉する（狭い画面では、重ねて出すほうを開閉する）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key !== ".") return;
      e.preventDefault();
      if (wide) setOpen(!open);
      else setDrawer((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, open]);
  const [drawer, setDrawer] = useState(false);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);

  // ⌘K / Ctrl+K でコマンドメニューを開閉する
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Box
      style={{ "--sidebar-width": `${wide ? clampSidebarWidth(sidebarWidth) : SIDEBAR_WIDTH}px` } as CSSProperties}
      // 背景画像のあるテーマ（星・方眼・水玉）では、本文側の面を透明にして、後ろの背景画像（ThemeBackdrop）を見せる
      sx={{ position: "relative", display: "flex", flexDirection: wide ? "row" : "column", height: "100vh", bgcolor: backdrop ? "transparent" : "background.paper" }}
    >
      <SkipLink />
      {wide && open && <SidebarResizer value={clampSidebarWidth(sidebarWidth)} defaultValue={SIDEBAR_WIDTH} onChange={setSidebarWidth} />}
      {wide ? (
        // 開閉は、幅を動かして出し入れする（どこが開いてどこが閉じたかを目で追えるように）。本文側も一緒に動く
        <Box
          ref={sidebarPeek.ref}
          {...sidebarPeek.handlers}
          sx={{
            position: "relative",
            flexShrink: 0,
            overflow: peek ? "visible" : "hidden",
            zIndex: peek ? (t) => t.zIndex.appBar : "auto",
            // 画面を移るときのフェードから外す（theme.ts）
            viewTransitionName: "admin-sidebar",
            // 右の境界線（1px）のぶんを足す
            width: open ? "calc(var(--sidebar-width) + 1px)" : COLLAPSED_WIDTH,
            borderRight: 1,
            borderColor: open ? "divider" : "transparent",
            transition: toggling ? `width ${MOTION_MS}ms ease, border-color ${MOTION_MS}ms ease` : "none",
            ...noMotion,
          }}
        >
          {/* 閉じている間は、見えない中身にフォーカスが入らないようにする。重ねて出している間は、本文の上に置く（列の幅は変えない） */}
          <Box
            inert={!open && !peek}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: "calc(var(--sidebar-width) + 1px)",
              borderRight: 1,
              borderColor: peek ? "divider" : "transparent",
              bgcolor: "background.default",
              boxShadow: peek ? 8 : "none",
              opacity: open || peek ? 1 : 0,
              visibility: open || peek ? "visible" : "hidden",
              transition: `opacity ${MOTION_MS}ms ease, visibility ${MOTION_MS}ms, box-shadow ${MOTION_MS}ms ease`,
              ...noMotion,
            }}
          >
            <Sidebar
              email={email}
              name={name}
              pictureUrl={pictureUrl}
              notifications
              onCollapse={peek ? undefined : () => setOpen(false)}
              onPin={peek ? () => setOpen(true) : undefined}
              onNavigate={peek ? sidebarPeek.close : undefined}
              onOpenCommands={() => setCommandOpen(true)}
              onLogout={onLogout}
            />
          </Box>
          <Box
            inert={open || peek}
            sx={{
              position: "absolute",
              top: 10,
              left: 0,
              width: COLLAPSED_WIDTH,
              display: "flex",
              justifyContent: "center",
              opacity: open ? 0 : 1,
              visibility: open ? "hidden" : "visible",
              transition: `opacity ${MOTION_MS}ms ease, visibility ${MOTION_MS}ms`,
              ...noMotion,
            }}
          >
            <Tooltip title="サイドバーを開く (⌘.)" placement="right">
              <IconButton size="small" aria-label="サイドバーを開く" onClick={() => setOpen(true)} sx={{ [TOUCH]: { width: 40, height: 40 } }}>
                <Menu size={18} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      ) : (
        // 狭い画面では横に列を取らず、上に細い帯を置く（左に空きを作らず、本文に幅を使う）
        <Box component="header" sx={{ flexShrink: 0, height: NARROW_BAR_HEIGHT, viewTransitionName: "admin-bar", px: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip title="サイドバーを開く (⌘.)" placement="bottom">
            <IconButton size="small" aria-label="サイドバーを開く" onClick={() => setDrawer(true)} sx={{ [TOUCH]: { width: 40, height: 40 } }}>
              <Menu size={18} />
            </IconButton>
          </Tooltip>
          <Typography variant="body2" noWrap sx={{ minWidth: 0, fontWeight: 600 }}>
            {wiki.name}
          </Typography>
          <Box ref={setBarSlot} sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5, flexShrink: 1, minWidth: 0 }} />
          {/* 通知のベルは、画面ごとの操作のさらに右（どの画面でも同じ場所） */}
          <Box sx={{ flexShrink: 0, ml: 0.5 }}>
            <NotificationBell />
          </Box>
        </Box>
      )}
      {/* 狭い画面では、サイドバーを本文に重ねて出す。「視差効果を減らす」が有効なら、滑らせずにすぐ出し入れする */}
      {/* 幅は、列のとき（264px）より広げる。指で操作する端末では行のボタンが大きく、264px だと深い階層のタイトルが2〜3文字しか出ない。右には、押して閉じるための背景を 56px 残す */}
      <Drawer
        open={!wide && drawer}
        onClose={() => setDrawer(false)}
        transitionDuration={reducedMotion ? 0 : undefined}
        slotProps={{ paper: { style: { "--sidebar-width": "min(320px, calc(100vw - 56px))" } as CSSProperties } }}
      >
        <Sidebar
          email={email}
          name={name}
          pictureUrl={pictureUrl}
          onNavigate={() => setDrawer(false)}
          onOpenCommands={() => {
            setDrawer(false);
            setCommandOpen(true);
          }}
          onLogout={onLogout}
        />
      </Drawer>
      <ShortcutGuide />
      <ConfirmHost />
      <ToastHost />
      <StarsHost />
      <Box {...mainProps} sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...mainSx, ...scrollingBackdropSx(backdrop) }}>
        <NarrowBarSlot.Provider value={barSlot}>
          <Outlet />
        </NarrowBarSlot.Provider>
      </Box>
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} onToggleSidebar={wide ? () => setOpen(!open) : undefined} onLogout={onLogout} />
    </Box>
  );
}

/**
 * スターの、画面をまたぐ仕事をまとめて受け持つ。
 * - wiki を開いたときに、以前ブラウザに覚えさせていたスターをサーバーへ移す
 * - 付け外しや並び替えに失敗したら知らせる（画面の表示は、失敗した時点で元に戻っている）
 */
function StarsHost() {
  useMigrateLegacyStars();
  const [error, clear] = useStarsError();
  return (
    <Snackbar open={error !== null} onClose={clear} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
      <Alert severity="error" variant="filled" onClose={clear}>
        スターを変更できませんでした。{error && errorMessage(error)}
      </Alert>
    </Snackbar>
  );
}
