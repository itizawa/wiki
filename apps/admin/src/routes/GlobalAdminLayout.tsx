import { ArrowLeft } from "lucide-react";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import { RouterLink } from "../components/ui";
import { useSession, useWikis } from "./Layout";
import { useScreenTitle } from "../lib/documentTitle";

/** 本物のリンク（Tab と Enter で移れ、新しいタブでも開ける）として描くタブ */
const TabLink = createLink(Tab);

/** 「全体の管理」のタブ。URL は画面ごとに分かれたまま（ブックマーク・「wiki を作成する」のリンクがそのまま使える） */
const TABS = [
  { to: "/wikis", label: "wiki" },
  { to: "/owners", label: "オーナー" },
  { to: "/audit", label: "監査ログ" },
  { to: "/routines", label: "Routine" },
  { to: "/costs", label: "コスト" },
] as const;

/**
 * 「全体の管理」：wiki をまたぐオーナー向けの画面（wiki・オーナー・すべての監査ログ・コスト）の共通の枠。
 * 上に「wiki の画面に戻る」と見出し、その下に3画面を行き来するタブ（オーナーにだけ）を置く。各画面の見出しは h2。
 * 入口はサイドバーの wiki の切り替えメニュー（オーナーにだけ出す）。
 */
export function GlobalAdminLayout() {
  const session = useSession();
  const wikis = useWikis();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = TABS.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? false;
  useScreenTitle(current ? `${TABS.find((t) => t.to === current)?.label} - 全体の管理` : "全体の管理");
  const hasActiveWiki = wikis.data?.wikis.some((w) => w.archivedAt === null) ?? true;

  return (
    <>
      <Box sx={{ mb: 1.5 }}>
        <RouterLink to="/" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          <ArrowLeft size={18} />
          {hasActiveWiki ? "wiki の画面に戻る" : "最初の画面に戻る"}
        </RouterLink>
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          全体の管理
        </Typography>
        {session.isOwner && (
          <Tabs value={current} aria-label="全体の管理" sx={{ mt: 1, borderBottom: 1, borderColor: "divider" }}>
            {TABS.map((t) => (
              <TabLink key={t.to} to={t.to} value={t.to} label={t.label} />
            ))}
          </Tabs>
        )}
      </Box>
      <Outlet />
    </>
  );
}
