import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WORKFLOW_NAME_MAX, workflowInput, type Workflow } from "@wiki/shared";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";

/** 入力したワークフロー名の誤り（空・長すぎ）。誤りが無ければ null。API に送る前に、入力欄の下へその場で出す。 */
export function workflowNameProblem(name: string): string | null {
  const parsed = workflowInput.safeParse({ name });
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "名前を確かめてください");
}

/**
 * ワークフローの名前を入れるダイアログ。`workflow` を渡すと名前の変更、渡さないと新しく作る。
 * 誤り（空・長すぎ・同じ名前がある・数の上限）は、入力欄の下にその場で出す。
 */
export function WorkflowNameDialog({ workflow, onClose, onDone }: { workflow: Workflow | null; onClose: () => void; onDone: (saved: Workflow) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(workflow?.name ?? "");
  // 押したあとに初めて、入力の誤りを出す（打っている途中に赤くしない）
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: (n: string) => (workflow ? api.renameWorkflow(workflow.id, n) : api.createWorkflow(n)),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ["workflow"] });
      onDone(saved);
    },
  });
  const problem = submitted ? workflowNameProblem(name) : null;
  const message = problem ?? (save.error ? errorMessage(save.error) : null);
  const length = name.trim().length;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="workflow-name-title">
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (workflowNameProblem(name) === null && !save.isPending) save.mutate(name.trim());
        }}
      >
        <DialogTitle id="workflow-name-title">{workflow ? `「${workflow.name}」の名前を変える` : "ワークフローを作る"}</DialogTitle>
        <DialogContent>
          <TextField
            label="ワークフローの名前"
            autoFocus
            fullWidth
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              save.reset();
            }}
            error={message !== null}
            helperText={message ?? `${WORKFLOW_NAME_MAX}文字まで。同じ wiki の中で、ほかのワークフローと重ならない名前にします（いま ${length} 文字）。`}
            placeholder="例：校正"
            slotProps={{ htmlInput: { maxLength: WORKFLOW_NAME_MAX + 20, autoComplete: "off" }, inputLabel: { shrink: true } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{workflow ? "変えずに閉じる" : "作らずに閉じる"}</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>
            {save.isPending ? "保存しています…" : workflow ? "名前を変える" : "作る"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
