import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { WORKFLOWS_MAX, type Workflow } from "@wiki/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { DataList, type ColumnLayout, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { Muted, RouterLink, Row, Section } from "../components/ui";
import { api } from "../lib/api";
import { useScreenTitle } from "../lib/documentTitle";
import { formatDateTime } from "../lib/format";
import { useWiki, workflowLink } from "../lib/wiki";
import { WorkflowNameDialog } from "./WorkflowNameDialog";

const ROW_HEIGHT = 56;

/** ワークフローの一覧の列の幅と、狭い幅（md 未満）での扱い。狭い幅では名前だけを残し、補足のブロックの数（開けば並んでいる）と作った日時は隠す。 */
export const workflowColumnLayout = {
  name: { width: "minmax(160px, 1fr)" },
  blocks: { width: "100px", narrow: "hide" },
  createdAt: { width: "160px", narrow: "hide" },
} satisfies ColumnLayout;

/**
 * 「ワークフロー」（`/w/{key}/workflows`）：サイドバーから開く、設定とは独立した画面。この wiki のワークフローの一覧と、作る操作。管理者だけ。
 * 1つのワークフローを開くと（`/workflows/{id}`）、そのブロックと実行の履歴が出る（`WorkflowDetailPage`）。
 */
export function WorkflowsPage() {
  const { wiki, role } = useWiki();
  useScreenTitle("ワークフロー");

  return (
    <Stack spacing={1.5}>
      <Section sx={{ mb: 0 }}>
        {role !== "admin" ? (
          <>
            <HelpHeading variant="h6" component="h1" help={<>「{wiki.name}」のワークフローです。wiki ごとに持ち、ほかの wiki には影響しません。</>}>
              ワークフロー
            </HelpHeading>
            <Alert severity="info" sx={{ mt: 1 }}>
              ワークフローは、この wiki の管理者だけが使えます。
            </Alert>
          </>
        ) : (
          <WorkflowList wikiName={wiki.name} />
        )}
      </Section>
    </Stack>
  );
}

/** ワークフローの一覧。行を押すと、そのワークフローの詳細へ移る。 */
function WorkflowList({ wikiName }: { wikiName: string }) {
  const list = useQuery({ queryKey: ["workflow"], queryFn: api.listWorkflows });
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const workflows = list.data?.workflows;
  const full = (workflows?.length ?? 0) >= WORKFLOWS_MAX;

  const columns: DataListColumn<Workflow>[] = [
    {
      key: "name",
      header: "名前",
      ...workflowColumnLayout.name,
      sx: { overflowWrap: "anywhere" },
      render: (w) => <RouterLink {...workflowLink(w.id)}>{w.name}</RouterLink>,
    },
    { key: "blocks", header: "ブロック", ...workflowColumnLayout.blocks, sx: { whiteSpace: "nowrap" }, render: (w) => `${w.blockCount} 件` },
    { key: "createdAt", header: "作った日時", ...workflowColumnLayout.createdAt, sx: { whiteSpace: "nowrap" }, render: (w) => <Muted component="span">{formatDateTime(w.createdAt)}</Muted> },
  ];

  return (
    <>
      <Row sx={{ mb: 1, flexWrap: "nowrap" }}>
        <HelpHeading
          variant="h6"
          component="h1"
          sx={{ flex: "1 1 auto", minWidth: 0 }}
          help={
            <>
              「{wikiName}」のワークフローです。用途ごと（例：校正、公開前チェック）に名前を付けて、1つの wiki に{WORKFLOWS_MAX}個まで作れます。ワークフローごとに、ブロックと実行の履歴を持ちます。wiki ごとに持ち、ほかの wiki には影響しません。
            </>
          }
        >
          ワークフロー
        </HelpHeading>
        <Button variant="contained" startIcon={<Plus size={18} />} disabled={full} onClick={() => setCreating(true)} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          ワークフローを作る
        </Button>
      </Row>
      {full && (
        <Alert severity="info" sx={{ mb: 1 }}>
          ワークフローは1つの wiki に{WORKFLOWS_MAX}個までです。新しく作るには、使っていないものを削除してください。
        </Alert>
      )}
      <DataList
        label="ワークフローの一覧"
        columns={columns}
        rows={workflows}
        rowKey={(w) => w.id}
        rowLink={(w) => workflowLink(w.id)}
        error={list.error}
        empty="ワークフローはまだありません。ここは、タグが付いたときに動く「ブロック」を、用途ごとにまとめて持つ画面です。右上の「ワークフローを作る」から作ってください。"
        rowHeight={ROW_HEIGHT}
        skeletonRows={3}
      />
      {/* 作ったら、そのワークフローの詳細へ移る（続けてブロックを作れる） */}
      {creating && <WorkflowNameDialog workflow={null} onClose={() => setCreating(false)} onDone={(saved) => void navigate(workflowLink(saved.id))} />}
    </>
  );
}
