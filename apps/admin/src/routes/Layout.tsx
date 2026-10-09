import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { api, ApiError } from "../lib/api";

export function Layout() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();

  if (me.isPending) return <div className="center muted">読み込み中…</div>;
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
    return <Login forbidden={me.error.status === 403} />;
  }
  if (me.error) return <div className="center error">APIに接続できません: {me.error.message}</div>;

  return (
    <div className="app">
      <header className="header">
        <strong className="brand">wiki 管理</strong>
        <nav>
          <Link to="/" activeOptions={{ exact: true }}>ページ</Link>
          <Link to="/tree">ツリー</Link>
          <Link to="/calendar">編集カレンダー</Link>
          <Link to="/history">構造の履歴</Link>
        </nav>
        <span className="spacer" />
        <span className="muted small">{me.data.email}</span>
        <button
          className="link"
          onClick={async () => {
            await api.logout();
            qc.clear();
            await qc.invalidateQueries({ queryKey: ["me"] });
          }}
        >
          ログアウト
        </button>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function Login({ forbidden }: { forbidden: boolean }) {
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const qc = useQueryClient();
  const denied = forbidden || new URLSearchParams(location.search).get("error") === "forbidden";
  return (
    <div className="center">
      <div className="card login">
        <h1>wiki 管理画面</h1>
        {denied && <p className="error">このアカウントには管理権限がありません。</p>}
        {providers.data?.google !== false && (
          <a className="button primary" href="/api/auth/google/login">
            Googleでログイン
          </a>
        )}
        {providers.data?.devLogin && (
          <button
            className="button"
            onClick={async () => {
              await api.devLogin();
              await qc.invalidateQueries({ queryKey: ["me"] });
            }}
          >
            開発用ログイン
          </button>
        )}
        {providers.data && !providers.data.google && !providers.data.devLogin && (
          <p className="muted small">Googleログインが未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。</p>
        )}
      </div>
    </div>
  );
}
