import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { ConfirmHost } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { Section } from "../components/ui";
import { useScreenTitle } from "../lib/documentTitle";
import { useWiki } from "../lib/wiki";
import { WorkflowBlocksSection } from "./WorkflowBlocksSection";
import { WorkflowRunsSection } from "./WorkflowRunsSection";

/**
 * 「ワークフロー」（`/w/{key}/workflows`）：サイドバーから開く、設定とは独立した画面。ブロックと実行の履歴。管理者だけ。
 * タグは設定の「タグ管理」タブ（`TagSettingsPage`）にある。
 */
export function WorkflowsPage() {
  const { wiki, role } = useWiki();
  useScreenTitle("ワークフロー");

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      <Section sx={{ mb: 0 }}>
        <HelpHeading variant="h6" component="h1" help={<>「{wiki.name}」のワークフローです。wiki ごとに持ち、ほかの wiki には影響しません。</>}>
          ワークフロー
        </HelpHeading>
      </Section>
      {role !== "admin" ? <Alert severity="info">ワークフローは、この wiki の管理者だけが使えます。</Alert> : <WorkflowSections />}
    </Stack>
  );
}

/** 管理者に出す節の並び。ブロック・履歴の節は、ここに足す。 */
function WorkflowSections() {
  return (
    <>
      <WorkflowBlocksSection />
      <WorkflowRunsSection />
    </>
  );
}
