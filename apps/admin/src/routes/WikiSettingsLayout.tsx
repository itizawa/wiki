import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import { Muted, Section } from "../components/ui";
import { useWiki } from "../lib/wiki";

/** 本物のリンク（Tab と Enter で移れ、新しいタブでも開ける）として描くタブ */
const TabLink = createLink(Tab);

type SettingsTab = {
  /** `/w/{key}/settings` のあとの部分（一般は空） */
  path: "" | "/appearance" | "/home" | "/integrations" | "/members" | "/audit";
  to:
    | "/w/$wikiKey/settings"
    | "/w/$wikiKey/settings/appearance"
    | "/w/$wikiKey/settings/home"
    | "/w/$wikiKey/settings/integrations"
    | "/w/$wikiKey/settings/members"
    | "/w/$wikiKey/settings/audit";
  label: string;
  /** 管理者にだけ出す（ほかの人が URL で直接開いたときは、各画面が「管理者だけ」の案内を出す） */
  adminOnly?: boolean;
};

const TABS: SettingsTab[] = [
  { path: "", to: "/w/$wikiKey/settings", label: "一般" },
  { path: "/appearance", to: "/w/$wikiKey/settings/appearance", label: "外観", adminOnly: true },
  { path: "/home", to: "/w/$wikiKey/settings/home", label: "トップページ", adminOnly: true },
  { path: "/integrations", to: "/w/$wikiKey/settings/integrations", label: "連携" },
  { path: "/members", to: "/w/$wikiKey/settings/members", label: "メンバー" },
  { path: "/audit", to: "/w/$wikiKey/settings/audit", label: "監査ログ", adminOnly: true },
];

/**
 * `/w/{key}/settings/...`：wiki ごとの設定。見出し「設定」と、タブ（一般・外観・トップページ・連携・メンバー・監査ログ）を出し、
 * 下にいまのタブの画面を出す。タブごとに URL を分ける（再読み込み・URL の共有で同じタブが開く）。各画面の見出しは h2。
 */
export function WikiSettingsLayout() {
  const { wiki, role } = useWiki();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/w/${wiki.key}/settings`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/$/, "") : "";
  const tabs = TABS.filter((t) => !t.adminOnly || role === "admin");
  const current = tabs.find((t) => t.path === rest)?.to ?? false;

  return (
    <Box>
      <Section sx={{ pb: 0, mb: 1.5 }}>
        <Typography variant="h6" component="h1">
          設定
        </Typography>
        <Muted>「{wiki.name}」の設定です。wiki ごとに持ち、ほかの wiki には影響しません。</Muted>
        <Tabs value={current} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="設定" sx={{ mt: 1 }}>
          {tabs.map((t) => (
            <TabLink key={t.to} to={t.to} params={{ wikiKey: wiki.key }} value={t.to} label={t.label} />
          ))}
        </Tabs>
      </Section>
      <Outlet />
    </Box>
  );
}
