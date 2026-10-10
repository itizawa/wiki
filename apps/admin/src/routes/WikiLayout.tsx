import MenuIcon from "@mui/icons-material/Menu";
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
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CommandMenu } from "../components/CommandMenu";
import { ConfirmHost } from "../components/ConfirmDialog";
import { ShortcutGuide } from "../components/ShortcutGuide";
import { Sidebar, SIDEBAR_WIDTH } from "../components/Sidebar";
import { clampSidebarWidth, SidebarResizer } from "../components/SidebarResizer";
import { Tooltip } from "../components/Tooltip";
import { Muted, RouterLink, Section } from "../components/ui";
import { errorMessage, setApiWiki } from "../lib/api";
import { useMigrateLegacyStars, useStarsError } from "../lib/stars";
import { usePersistentState } from "../lib/storage";
import { rememberWiki, WikiContext } from "../lib/wiki";
import { Center, Loading, useSession, useWikis } from "./Layout";

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

  return (
    <Box
      style={{ "--sidebar-width": `${wide ? clampSidebarWidth(sidebarWidth) : SIDEBAR_WIDTH}px` } as CSSProperties}
      sx={{ position: "relative", display: "flex", height: "100vh", bgcolor: "background.paper" }}
    >
      {wide && open && <SidebarResizer value={clampSidebarWidth(sidebarWidth)} defaultValue={SIDEBAR_WIDTH} onChange={setSidebarWidth} />}
      {wide && open ? (
        <Box sx={{ flexShrink: 0, borderRight: 1, borderColor: "divider" }}>
          <Sidebar email={email} onCollapse={() => setOpen(false)} onOpenCommands={() => setCommandOpen(true)} onLogout={onLogout} />
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
      <StarsHost />
      <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
        <Outlet />
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
