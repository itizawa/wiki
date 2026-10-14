import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Workflow } from "@wiki/shared";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading } from "../components/HelpTip";
import { RouterLink, Row, Section, SkeletonSection } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { useScreenTitle } from "../lib/documentTitle";
import { screenLink, useWiki } from "../lib/wiki";
import { WorkflowBlocksSection } from "./WorkflowBlocksSection";
import { WorkflowNameDialog } from "./WorkflowNameDialog";
import { WorkflowRunsSection } from "./WorkflowRunsSection";

/** タブの題。「{名前} - ワークフロー」（読み込むまでは触らない） */
export function workflowDetailTitle(workflow: Workflow | undefined): string | null {
  return workflow ? `${workflow.name} - ワークフロー` : null;
}

/** 削除の確認に出す文。ブロックも消えると伝える */
export function deleteWorkflowBody(blockCount: number): string {
  const blocks = blockCount === 0 ? "ブロックはありません。" : `ブロック ${blockCount} 件も消えます。`;
  return `${blocks}このワークフローの実行の履歴も、いっしょに消えます。タグと Routine は消えません。元に戻せません。`;
}

/**
 * 1つのワークフロー（`/w/{key}/workflows/{workflowId}`）：名前の変更と削除、ブロック、実行の履歴。管理者だけ。
 * 履歴はこのワークフローのものだけを出す。
 */
export function WorkflowDetailPage({ workflowId }: { workflowId: string }) {
  const { role } = useWiki();
  const isAdmin = role === "admin";
  const workflow = useQuery({ queryKey: ["workflow", workflowId], queryFn: () => api.getWorkflow(workflowId), enabled: isAdmin, retry: false });
  useScreenTitle(workflowDetailTitle(workflow.data) ?? (isAdmin ? null : "ワークフロー"));

  const notFound = workflow.error instanceof ApiError && workflow.error.status === 404;

  return (
    <Stack spacing={1.5}>
      <BackLink />
      {!isAdmin ? (
        <Section>
          <Alert severity="info">ワークフローは、この wiki の管理者だけが使えます。</Alert>
        </Section>
      ) : notFound ? (
        <Section>
          <Alert severity="warning">このワークフローは見つかりません。削除されたか、別の wiki のものかもしれません。</Alert>
        </Section>
      ) : workflow.error ? (
        <Section>
          <Alert severity="error">ワークフローを読み込めませんでした：{errorMessage(workflow.error)}</Alert>
        </Section>
      ) : !workflow.data ? (
        <SkeletonSection lines={2} label="ワークフローを読み込み中" />
      ) : (
        <>
          <WorkflowHeader workflow={workflow.data} />
          <WorkflowBlocksSection workflowId={workflowId} />
          <WorkflowRunsSection workflowId={workflowId} />
        </>
      )}
    </Stack>
  );
}

/** 一覧へ戻るリンク（遷移なので、ボタンではなくリンク） */
function BackLink() {
  return (
    <RouterLink {...screenLink("/w/$wikiKey/workflows")} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, alignSelf: "flex-start" }}>
      <ChevronLeft size={16} aria-hidden />
      ワークフローの一覧
    </RouterLink>
  );
}

/** 見出し（名前）と、名前の変更・削除。取り返しのつかない削除は、名前の変更から離して置く */
function WorkflowHeader({ workflow }: { workflow: Workflow }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.deleteWorkflow(workflow.id),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ["workflow", workflow.id] });
      qc.removeQueries({ queryKey: ["workflow-runs", workflow.id] });
      await qc.invalidateQueries({ queryKey: ["workflow"] });
      await navigate(screenLink("/w/$wikiKey/workflows"));
    },
  });

  const askDelete = async () => {
    const ok = await confirmDialog({
      title: `ワークフロー「${workflow.name}」を削除しますか？`,
      body: deleteWorkflowBody(workflow.blockCount),
      confirmLabel: "削除する",
      cancelLabel: "削除せずに戻る",
      danger: true,
    });
    if (ok) {
      setDone(null);
      remove.reset();
      remove.mutate();
    }
  };

  return (
    <Section>
      <Row sx={{ flexWrap: "wrap", justifyContent: "space-between", gap: 1 }}>
        <HelpHeading
          variant="h6"
          component="h1"
          sx={{ flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" }}
          help="このワークフローのブロックと、実行の履歴です。ワークフローを削除すると、ブロックと実行の履歴もいっしょに消えます。"
        >
          {workflow.name}
        </HelpHeading>
        <Row sx={{ flexWrap: "nowrap" }}>
          <Button variant="outlined" aria-label={`ワークフロー「${workflow.name}」の名前を変える`} onClick={() => setRenaming(true)} sx={{ whiteSpace: "nowrap" }}>
            名前を変える
          </Button>
          <Button variant="outlined" color="error" aria-label={`ワークフロー「${workflow.name}」を削除`} disabled={remove.isPending} onClick={askDelete} sx={{ ml: 3, whiteSpace: "nowrap" }}>
            削除
          </Button>
        </Row>
      </Row>
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mt: 1 }}>
          {done}
        </Alert>
      )}
      {remove.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          削除できませんでした：{errorMessage(remove.error)}
        </Alert>
      )}
      {renaming && (
        <WorkflowNameDialog
          workflow={workflow}
          onClose={() => setRenaming(false)}
          onDone={(saved) => {
            setRenaming(false);
            setDone(`名前を「${saved.name}」に変えました。`);
          }}
        />
      )}
    </Section>
  );
}
