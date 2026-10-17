import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import { createLink, Outlet, useRouterState } from "@tanstack/react-router";
import { HelpHeading } from "../components/HelpTip";
import { NavTabs } from "../components/NavTabs";
import { Section } from "../components/ui";
import { useWiki } from "../lib/wiki";
import { useScreenTitle } from "../lib/documentTitle";

/** 本物のリンク（Tab と Enter で移れ、新しいタブでも開ける）として描くタブ */
const TabLink = createLink(Tab);

type SettingsTab = {
  /** `/w/{key}/settings` のあとの部分（一般は空） */
  path: "" | "/appearance" | "/home" | "/integrations" | "/sns" | "/tags" | "/members" | "/audit";
  to:
    | "/w/$wikiKey/settings"
    | "/w/$wikiKey/settings/appearance"
    | "/w/$wikiKey/settings/home"
    | "/w/$wikiKey/settings/integrations"
    | "/w/$wikiKey/settings/sns"
    | "/w/$wikiKey/settings/tags"
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
  { path: "/integrations", to: "/w/$wikiKey/settings/integrations", label: "Google 連携" },
  { path: "/sns", to: "/w/$wikiKey/settings/sns", label: "SNS", adminOnly: true },
  { path: "/tags", to: "/w/$wikiKey/settings/tags", label: "タグ管理", adminOnly: true },
  { path: "/members", to: "/w/$wikiKey/settings/members", label: "メンバー" },
  { path: "/audit", to: "/w/$wikiKey/settings/audit", label: "監査ログ", adminOnly: true },
];

/**
 * `/w/{key}/settings/...`：wiki ごとの設定。見出し「設定」と、タブ（一般・外観・トップページ・Google 連携・SNS・タグ管理・メンバー・監査ログ）を出し、
 * 下にいまのタブの画面を出す。タブごとに URL を分ける（再読み込み・URL の共有で同じタブが開く）。各画面の見出しは h2。
 */
export function WikiSettingsLayout() {
  const { wiki, role } = useWiki();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const base = `/w/${wiki.key}/settings`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/\/$/, "") : "";
  const tabs = TABS.filter((t) => !t.adminOnly || role === "admin");
  const current = tabs.find((t) => t.path === rest)?.to ?? false;
  // 管理者だけのタブを URL で直接開いた人にも、そのタブの名前を出す
  const tabLabel = TABS.find((t) => t.path === rest)?.label;
  useScreenTitle(tabLabel && rest !== "" ? `${tabLabel} - 設定` : "設定");

  return (
    <Box>
      <Section sx={{ pb: 0, mb: 1.5 }}>
        <HelpHeading variant="h6" component="h1" help={<>「{wiki.name}」の設定です。wiki ごとに持ち、ほかの wiki には影響しません。</>}>
          設定
        </HelpHeading>
        <NavTabs value={current} aria-label="設定" sx={{ mt: 0.5 }}>
          {tabs.map((t) => (
            <TabLink key={t.to} to={t.to} params={{ wikiKey: wiki.key }} value={t.to} label={t.label} />
          ))}
        </NavTabs>
      </Section>
      <Outlet />
    </Box>
  );
}
