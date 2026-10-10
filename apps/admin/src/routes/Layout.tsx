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

export function Layout() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [sidebarWidth, setSidebarWidth] = usePersistentState("wiki.sidebar.width", SIDEBAR_WIDTH);
  const qc = useQueryClient();
  const wide = useMediaQuery((t) => t.breakpoints.up("md"));
  const [open, setOpen] = usePersistentState("wiki.sidebar.open", true);

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
  }, [wide, open, setOpen]);
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
      {wide && open ? (
        <Box sx={{ flexShrink: 0, borderRight: 1, borderColor: "divider" }}>
          <Sidebar email={me.data.email} onCollapse={() => setOpen(false)} onOpenCommands={() => setCommandOpen(true)} onLogout={logout} />
        </Box>
      ) : (
        <Box sx={{ flexShrink: 0, width: 44, pt: 1.25, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
          <Tooltip title="サイドバーを開く (⌘.)" placement="right">
            <IconButton size="small" aria-label="サイドバーを開く" onClick={() => (wide ? setOpen(true) : setDrawer(true))}>
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
