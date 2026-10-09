import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Muted, RouterLink, Section } from "../components/ui";
import { api, ApiError } from "../lib/api";

export function Layout() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();

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

  return (
    <div>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Toolbar variant="dense" sx={{ gap: 2 }}>
          <Typography component="strong" sx={{ fontWeight: 700 }}>
            wiki 管理
          </Typography>
          <Stack
            component="nav"
            direction="row"
            spacing={1.75}
            sx={{ flexGrow: 1, '& a[data-status="active"]': { fontWeight: 600, color: "text.primary" } }}
          >
            <RouterLink to="/" activeOptions={{ exact: true }}>
              ページ
            </RouterLink>
            <RouterLink to="/tree">ツリー</RouterLink>
            <RouterLink to="/calendar">編集カレンダー</RouterLink>
            <RouterLink to="/history">構造の履歴</RouterLink>
          </Stack>
          <Muted>{me.data.email}</Muted>
          <Button
            variant="text"
            onClick={async () => {
              await api.logout();
              qc.clear();
              await qc.invalidateQueries({ queryKey: ["me"] });
            }}
          >
            ログアウト
          </Button>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: 2.5, maxWidth: 1400, mx: "auto" }}>
        <Outlet />
      </Box>
    </div>
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
