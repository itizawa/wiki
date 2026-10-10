import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, Navigate, Outlet } from "@tanstack/react-router";
import { createContext, useContext, type ReactNode } from "react";
import { Muted, Section } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { lastWikiKey, pickWiki } from "../lib/wiki";

/** ログイン中の人と、ログアウトの操作。ログインの確認が済んだ画面（Root の下）で使える。 */
export type Session = { email: string; isOwner: boolean; logout: () => void };
const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used after login");
  return value;
}

/** wiki の一覧（切り替え・管理の画面で共有する）。 */
export function useWikis() {
  return useQuery({ queryKey: ["wikis"], queryFn: api.listWikis });
}

/** すべての画面の入口：ログインを確かめ、済んでいれば中の画面を出す。 */
export function Root() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();

  if (me.isPending) return <Loading />;
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
    <SessionContext.Provider value={{ ...me.data, logout }}>
      <Outlet />
    </SessionContext.Provider>
  );
}

const ButtonLink = createLink(Button);

/** `/`：最後に開いていた wiki へ移す。使用中の wiki が1つも無ければ「wiki を作成する」だけを出す。 */
export function Home() {
  const session = useSession();
  const wikis = useWikis();

  if (wikis.isPending) return <Loading />;
  if (wikis.error) {
    return (
      <Center>
        <Alert severity="error">{errorMessage(wikis.error)}</Alert>
      </Center>
    );
  }
  const wiki = pickWiki(wikis.data.wikis, lastWikiKey());
  if (wiki) return <Navigate to="/w/$wikiKey" params={{ wikiKey: wiki.key }} replace />;

  return (
    <Center>
      <Section sx={{ maxWidth: 420, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <Typography variant="h5" component="h1">
            使用中の wiki がありません
          </Typography>
          {session.isOwner ? (
            <>
              <Muted>wiki を作ると、ページを書いて公開できるようになります。アーカイブした wiki は、作成の画面から元に戻せます。</Muted>
              <ButtonLink to="/wikis" variant="contained" size="medium" startIcon={<AddIcon />}>
                wiki を作成する
              </ButtonLink>
            </>
          ) : (
            <Muted>wiki を作れるのはオーナーだけです。オーナーに、wiki の作成を頼んでください。</Muted>
          )}
          <Button variant="text" onClick={session.logout}>
            ログアウトする
          </Button>
        </Stack>
      </Section>
    </Center>
  );
}

export function Loading() {
  return (
    <Center>
      <CircularProgress aria-label="読み込み中" />
    </Center>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <Box sx={{ display: "grid", placeItems: "center", minHeight: "100vh", p: 2 }}>{children}</Box>;
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
