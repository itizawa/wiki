import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Button, buttonClass } from "../components/Button";
import { LinkButton } from "../components/LinkButton";
import { api, ApiError } from "../lib/api";
import { cx } from "../lib/cx";
import ui from "../styles/ui.module.css";
import styles from "./Layout.module.css";

const activeProps = { className: styles.active };

export function Layout() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();

  if (me.isPending) return <div className={cx(ui.center, ui.muted)}>読み込み中…</div>;
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
    return <Login forbidden={me.error.status === 403} />;
  }
  if (me.error) return <div className={cx(ui.center, ui.error)}>APIに接続できません: {me.error.message}</div>;

  return (
    <div>
      <header className={styles.header}>
        <strong>wiki 管理</strong>
        <nav>
          <Link to="/" activeOptions={{ exact: true }} activeProps={activeProps}>ページ</Link>
          <Link to="/tree" activeProps={activeProps}>ツリー</Link>
          <Link to="/history" activeProps={activeProps}>構造の履歴</Link>
        </nav>
        <span className={ui.spacer} />
        <span className={cx(ui.muted, ui.small)}>{me.data.email}</span>
        <LinkButton
          onClick={async () => {
            await api.logout();
            qc.clear();
            await qc.invalidateQueries({ queryKey: ["me"] });
          }}
        >
          ログアウト
        </LinkButton>
      </header>
      <main className={styles.main}>
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
    <div className={ui.center}>
      <div className={cx(ui.card, styles.login)}>
        <h1>wiki 管理画面</h1>
        {denied && <p className={ui.error}>このアカウントには管理権限がありません。</p>}
        {providers.data?.google !== false && (
          <a className={buttonClass("primary")} href="/api/auth/google/login">
            Googleでログイン
          </a>
        )}
        {providers.data?.devLogin && (
          <Button
            onClick={async () => {
              await api.devLogin();
              await qc.invalidateQueries({ queryKey: ["me"] });
            }}
          >
            開発用ログイン
          </Button>
        )}
        {providers.data && !providers.data.google && !providers.data.devLogin && (
          <p className={cx(ui.muted, ui.small)}>Googleログインが未設定です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）。</p>
        )}
      </div>
    </div>
  );
}
