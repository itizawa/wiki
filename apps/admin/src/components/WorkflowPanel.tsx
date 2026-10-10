import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PageDetail, WorkflowState } from "@wiki/shared";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

export const workflowLabel: Record<WorkflowState, string> = { idea: "ネタ", draft: "下書き", approved: "承認済み" };

/** 「記事の状態」：承認（ルールが予約枠に入れてよい版を決める）と、見直しキュー。 */
/** 編集画面の「公開」ポップオーバーの上段に出す。 */
export function WorkflowPanel({ page, dirty }: { page: PageDetail; dirty: boolean }) {
  const qc = useQueryClient();
  const action = useMutation({
    mutationFn: (fn: () => Promise<PageDetail>) => fn(),
    onSuccess: (p) => {
      qc.setQueryData(["page", page.id], p);
      void qc.invalidateQueries({ queryKey: ["pages"] });
    },
  });
  const approve = () => api.setWorkflow(page.id, { state: "approved", versionId: page.headVersionId });
  // 承認は保存済みの版に付けるので、未保存の編集があるあいだは選べない
  const needsSave = dirty ? "先に保存してください" : "";

  return (
    <Box component="section" aria-label="記事の状態">
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="subtitle1" component="h3">
          記事の状態
        </Typography>
        <TextField
          select
          fullWidth
          value={page.workflowState}
          disabled={action.isPending}
          onChange={(e) => {
            const state = e.target.value as WorkflowState;
            action.mutate(() => (state === "approved" ? approve() : api.setWorkflow(page.id, { state })));
          }}
        >
          <MenuItem value="idea">{workflowLabel.idea}</MenuItem>
          <MenuItem value="draft">{workflowLabel.draft}</MenuItem>
          <MenuItem value="approved" disabled={dirty}>
            {workflowLabel.approved}
            {dirty && "（先に保存してください）"}
          </MenuItem>
        </TextField>
        {page.workflowState === "approved" && page.approvedVersionId === page.headVersionId && (
          <Muted>この版は、ルールが空いている予約枠に入れます。公開されるのは予約の時刻です。</Muted>
        )}
        {page.workflowState === "approved" && page.approvedVersionId !== page.headVersionId && (
          <>
            <Typography variant="body2" color="warning.main">
              承認後に編集があります。予約枠に入るのは承認した版です。
            </Typography>
            <Tooltip title={needsSave}>
              <span>
                <Button variant="outlined" disabled={dirty || action.isPending} onClick={() => action.mutate(approve)}>
                  最新版で承認し直す
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {page.reviewRequestedAt && (
          <Alert
            severity="info"
            sx={{ width: "100%" }}
            action={
              <Button variant="text" disabled={action.isPending} onClick={() => action.mutate(() => api.reviewDone(page.id))}>
                見直し済み
              </Button>
            }
          >
            見直しキューに入っています（{formatDateTime(page.reviewRequestedAt)}）
          </Alert>
        )}
        {action.error && <Alert severity="error">{errorMessage(action.error)}</Alert>}
      </Stack>
    </Box>
  );
}
