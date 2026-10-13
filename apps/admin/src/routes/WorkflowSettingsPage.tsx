import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import { ConfirmHost } from "../components/ConfirmDialog";
import { useWiki } from "../lib/wiki";
import { WorkflowBlocksSection } from "./WorkflowBlocksSection";

/**
 * 「設定」の「ワークフロー」タブ（`/w/{key}/settings/workflows`）：ブロック（これから実行の履歴）。管理者だけ。
 * タグは「タグ管理」タブ（`TagSettingsPage`）にある。
 */
export function WorkflowSettingsPage() {
  const { role } = useWiki();

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      {role !== "admin" ? <Alert severity="info">ワークフローの設定は、この wiki の管理者だけが行えます。</Alert> : <WorkflowBlocksSection />}
    </Stack>
  );
}
