import MenuIcon from "@mui/icons-material/Menu";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CommandMenu } from "../components/CommandMenu";
import { ConfirmHost } from "../components/ConfirmDialog";
import { ShortcutGuide } from "../components/ShortcutGuide";
import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar";
import { clampSidebarWidth, SidebarResizer } from "../components/SidebarResizer";
import { Tooltip } from "../components/Tooltip";
import { Muted, RouterLink, Section } from "../components/ui";
import { setApiWiki } from "../lib/api";
import { usePersistentState } from "../lib/storage";
import { rememberWiki, WikiContext } from "../lib/wiki";
import { Center, Loading, useSession, useWikis } from "./Layout";

/** 閉じたサイドバーの幅（開くボタンだけが残る）。 */
const COLLAPSED_WIDTH = 44;
/** 開閉の動きの長さ。短くして、操作を待たせない。 */
const MOTION_MS = 180;
/** OS の「視差効果を減らす」が有効なら、動かさずにすぐ切り替える。 */
const noMotion = { "@media (prefers-reduced-motion: reduce)": { transition: "none" } } as const;

/**
 * `/w/{key}/...`：1つの wiki を開いている画面。サイドバーと、その wiki の内容を出す。
 * 読み込んだデータ（ページ・ツリー・予約・ルール）は wiki ごとの入れ物に持ち、切り替えても別の wiki のものが出ないようにする。
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
    <WikiContext.Provider value={{ wiki, wikis: active, isOwner: session.isOwner }}>
      <QueryClientProvider client={queryClient}>
        <Shell email={session.email} onLogout={session.logout} />
      </QueryClientProvider>
    </WikiContext.Provider>
  );
}

function Shell({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [sidebarWidth, setSidebarWidth] = usePersistentState("wiki.sidebar.width", SIDEBAR_WIDTH);
  const wide = useMediaQuery((t) => t.breakpoints.up("md"));
  const [open, setOpenState] = usePersistentState("wiki.sidebar.open", true);
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
      sx={{ position: "relative", display: "flex", height: "100vh", bgcolor: "background.paper" }}
    >
      {wide && open && <SidebarResizer value={clampSidebarWidth(sidebarWidth)} defaultValue={SIDEBAR_WIDTH} onChange={setSidebarWidth} />}
      {wide ? (
        // 開閉は、幅を動かして出し入れする（どこが開いてどこが閉じたかを目で追えるように）。本文側も一緒に動く
        <Box
          sx={{
            position: "relative",
            flexShrink: 0,
            overflow: "hidden",
            // 右の境界線（1px）のぶんを足す
            width: open ? "calc(var(--sidebar-width) + 1px)" : COLLAPSED_WIDTH,
            borderRight: 1,
            borderColor: open ? "divider" : "transparent",
            transition: toggling ? `width ${MOTION_MS}ms ease, border-color ${MOTION_MS}ms ease` : "none",
            ...noMotion,
          }}
        >
          {/* 閉じている間は、見えない中身にフォーカスが入らないようにする */}
          <Box inert={!open} sx={{ height: "100%", opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden", transition: `opacity ${MOTION_MS}ms ease, visibility ${MOTION_MS}ms`, ...noMotion }}>
            <Sidebar email={email} onCollapse={() => setOpen(false)} onOpenCommands={() => setCommandOpen(true)} onLogout={onLogout} />
          </Box>
          <Box
            inert={open}
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
              <IconButton size="small" aria-label="サイドバーを開く" onClick={() => setOpen(true)}>
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      ) : (
        <Box sx={{ flexShrink: 0, width: COLLAPSED_WIDTH, pt: 1.25, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          <Tooltip title="サイドバーを開く (⌘.)" placement="right">
            <IconButton size="small" aria-label="サイドバーを開く" onClick={() => setDrawer(true)}>
              <MenuIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      {/* 狭い画面では、サイドバーを本文に重ねて出す */}
      <Drawer open={!wide && drawer} onClose={() => setDrawer(false)}>
        <Sidebar
          email={email}
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
      <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <Outlet />
      </Box>
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} onToggleSidebar={wide ? () => setOpen(!open) : undefined} onLogout={onLogout} />
    </Box>
  );
}
