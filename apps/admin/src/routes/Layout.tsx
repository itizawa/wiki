import MenuIcon from "@mui/icons-material/Menu";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import { Tooltip } from "../components/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { clampSidebarWidth, SidebarResizer } from "../components/SidebarResizer";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar";
import { CommandMenu } from "../components/CommandMenu";
import { Muted, Section } from "../components/ui";
import { ShortcutGuide } from "../components/ShortcutGuide";
import { api, ApiError } from "../lib/api";
import { usePersistentState } from "../lib/storage";

/** 閉じたサイドバーの幅（開くボタンだけが残る）。 */
const COLLAPSED_WIDTH = 44;
/** 開閉の動きの長さ。短くして、操作を待たせない。 */
const MOTION_MS = 180;
/** OS の「視差効果を減らす」が有効なら、動かさずにすぐ切り替える。 */
const noMotion = { "@media (prefers-reduced-motion: reduce)": { transition: "none" } } as const;

export function Layout() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [sidebarWidth, setSidebarWidth] = usePersistentState("wiki.sidebar.width", SIDEBAR_WIDTH);
  const qc = useQueryClient();
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

  if (me.isPending) {
    return (
      <Center>
        <CircularProgress aria-label="読み込み中" />
      </Center>
    );
  }
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
    return <Login forbidden={me.error.status === 403} />;
  }
  if (me.error) {
    return (
      <Center>
        <Alert severity="error">APIに接続できません: {me.error.message}</Alert>
      </Center>
    );
  }

  const logout = async () => {
    await api.logout();
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

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
            <Sidebar email={me.data.email} onCollapse={() => setOpen(false)} onOpenCommands={() => setCommandOpen(true)} onLogout={logout} />
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
          email={me.data.email}
          onNavigate={() => setDrawer(false)}
          onOpenCommands={() => {
            setDrawer(false);
            setCommandOpen(true);
          }}
          onLogout={logout}
        />
      </Drawer>
      <ShortcutGuide />
      <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <Outlet />
      </Box>
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} onToggleSidebar={wide ? () => setOpen(!open) : undefined} onLogout={logout} />
    </Box>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>{children}</Box>;
}

function Login({ forbidden }: { forbidden: boolean }) {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const qc = useQueryClient();
  const denied = forbidden || new URLSearchParams(location.search).get("error") === "forbidden";
  return (
    <Center>
      <Section sx={{ minWidth: 300, textAlign: "center" }}>
        <Stack spacing={1.5}>
          <Typography variant="h5" component="h1">
            wiki 管理画面
          </Typography>
          {denied && <Alert severity="error">このアカウントには管理権限がありません。</Alert>}
          {providers.data?.google !== false && (
            <Button variant="contained" size="medium" href="/api/auth/google/login">
              Googleでログイン
            </Button>
          )}
          {providers.data?.devLogin && (
            <Button
              variant="outlined"
              size="medium"
              onClick={async () => {
                await api.devLogin();
                await qc.invalidateQueries({ queryKey: ["me"] });
              }}
            >
              開発用ログイン
            </Button>
          )}
          {providers.data && !providers.data.google && !providers.data.devLogin && (
            <Muted>Googleログインが未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。</Muted>
          )}
        </Stack>
      </Section>
    </Center>
  );
}
