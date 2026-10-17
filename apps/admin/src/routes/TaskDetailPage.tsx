import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TASK_STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus, type UpdateTaskInput } from "@wiki/shared";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { HelpTip } from "../components/HelpTip";
import { Field, Muted, RouterLink, Row, Section, SkeletonSection } from "../components/ui";
import { api, ApiError, errorMessage } from "../lib/api";
import { useScreenTitle } from "../lib/documentTitle";
import { formatDateTime } from "../lib/format";
import { invalidateTasks, taskKeys } from "../lib/tasks";
import { pageLink, screenLink, useWiki, workflowLink } from "../lib/wiki";
import { useSession } from "./Layout";
import { assigneeChoices, TaskStatusBadge } from "./taskView";

/** タブの題。「{題} - タスク」（読み込むまでは触らない） */
export function taskDetailTitle(task: Task | undefined): string | null {
  return task ? `${task.title} - タスク` : null;
}

/** 状態を変えたあとに、操作した場所のそばに出す文 */
export function statusChangedMessage(before: Task, after: Task): string {
  if (after.status === "done" && before.run?.waiting) return "完了にしました。止まっていたワークフローの実行を、次のアクションから続けています。";
  return `「${TASK_STATUS_LABELS[after.status]}」にしました。`;
}

/**
 * 1つのタスク（`/w/{key}/tasks/{taskId}`）：説明・紐づくページ・作ったワークフローを読み、状態と担当者を変える。
 * wiki のメンバーなら誰でも変えられる（担当者でなくても）。完了にすると、止まっていたワークフローの実行が続きから動く
 */
export function TaskDetailPage({ taskId }: { taskId: string }) {
  const task = useQuery({ queryKey: taskKeys.detail(taskId), queryFn: () => api.getTask(taskId), retry: false });
  useScreenTitle(taskDetailTitle(task.data));
  const notFound = task.error instanceof ApiError && task.error.status === 404;

  return (
    <Stack spacing={1.5}>
      <RouterLink {...screenLink("/w/$wikiKey/tasks")} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, alignSelf: "flex-start" }}>
        <ChevronLeft size={16} aria-hidden />
        タスクの一覧
      </RouterLink>
      {notFound ? (
        <Section>
          <Alert severity="warning">このタスクは見つかりません。別の wiki のものかもしれません。</Alert>
        </Section>
      ) : task.error ? (
        <Section>
          <Alert severity="error">タスクを読み込めませんでした：{errorMessage(task.error)}</Alert>
        </Section>
      ) : !task.data ? (
        <SkeletonSection lines={4} label="タスクを読み込み中" />
      ) : (
        <TaskBody task={task.data} />
      )}
    </Stack>
  );
}

function TaskBody({ task }: { task: Task }) {
  const qc = useQueryClient();
  const me = useSession();
  const { role } = useWiki();
  const members = useQuery({ queryKey: ["members"], queryFn: api.listMembers });
  const [notice, setNotice] = useState<{ at: "status" | "assignee"; text: string } | null>(null);
  const update = useMutation({
    mutationFn: (input: UpdateTaskInput & { at: "status" | "assignee" }) => api.updateTask(task.id, { status: input.status, assigneeId: input.assigneeId }),
    onSuccess: async (after, input) => {
      qc.setQueryData(taskKeys.detail(task.id), after);
      setNotice({
        at: input.at,
        text: input.at === "status" ? statusChangedMessage(task, after) : after.assignee ? `担当者を${after.assignee.id === me.id ? "自分" : `「${after.assignee.name}」`}にしました。` : "担当者を外しました。",
      });
      await invalidateTasks(qc);
    },
  });
  const change = (input: UpdateTaskInput & { at: "status" | "assignee" }) => {
    setNotice(null);
    update.mutate(input);
  };
  const choices = assigneeChoices(members.data?.members ?? [], me, task.assignee);
  const failedAt = update.error ? update.variables?.at : null;

  return (
    <Section>
      <Row sx={{ mb: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {task.title}
        </Typography>
        <TaskStatusBadge status={task.status} />
      </Row>
      {task.description ? (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mb: 2 }}>
          {task.description}
        </Typography>
      ) : (
        <Muted variant="body2" sx={{ mb: 2 }}>
          説明はありません。
        </Muted>
      )}

      <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 2, rowGap: 0.75, m: 0, mb: 3, "& dt": { color: "text.secondary" }, "& dd": { m: 0, overflowWrap: "anywhere" } }}>
        <dt>ページ</dt>
        <dd>{!task.page ? "なし" : task.page.available ? <RouterLink {...pageLink(task.page.id)}>{task.page.title || "無題"}</RouterLink> : task.page.title}</dd>
        <dt>ワークフロー</dt>
        <dd>
          {!task.workflow ? (
            "（削除されたワークフロー）"
          ) : role === "admin" ? (
            <RouterLink {...workflowLink(task.workflow.id)}>{task.workflow.name}</RouterLink>
          ) : (
            task.workflow.name
          )}
          {task.run?.waiting && "（このタスクの完了を待っています）"}
        </dd>
        <dt>作った日時</dt>
        <dd>{formatDateTime(task.createdAt)}</dd>
        {task.completedAt && (
          <>
            <dt>完了</dt>
            <dd>
              {formatDateTime(task.completedAt)}
              {task.completedBy && `（${task.completedBy.name}）`}
            </dd>
          </>
        )}
      </Box>

      <Stack spacing={3}>
        <Box>
          <Row sx={{ mb: 1, gap: 0.5 }}>
            <Typography id="task-status-label" variant="body2" sx={{ fontWeight: 600 }}>
              状態
            </Typography>
            <HelpTip about="タスクの状態">
              押すとすぐに変わります。「完了」にすると、このタスクを待っていたワークフローの実行が、次のアクションから続きます（一度だけ。完了から戻しても、実行は巻き戻りません）。
            </HelpTip>
          </Row>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={task.status}
            disabled={update.isPending}
            aria-labelledby="task-status-label"
            // 選んでいるものをもう一度押しても、外さない
            onChange={(_, next: TaskStatus | null) => next !== null && next !== task.status && change({ at: "status", status: next })}
          >
            {TASK_STATUSES.map((s) => (
              <ToggleButton key={s} value={s} sx={{ px: 2 }}>
                {TASK_STATUS_LABELS[s]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Feedback at="status" notice={notice} error={failedAt === "status" ? update.error : null} />
        </Box>

        <Box>
          <Row sx={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field
              select
              label="担当者"
              value={task.assignee?.id ?? ""}
              disabled={update.isPending}
              onChange={(e) => change({ at: "assignee", assigneeId: e.target.value || null })}
              slotProps={{ select: { native: true } }}
              sx={{ minWidth: 220, maxWidth: 320, flex: "1 1 220px" }}
            >
              <option value="">担当者なし（メンバーの誰でも）</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === me.id ? `${c.name}（自分）` : c.name}
                </option>
              ))}
            </Field>
            {task.assignee?.id !== me.id && (
              <Button variant="outlined" disabled={update.isPending} onClick={() => change({ at: "assignee", assigneeId: me.id })}>
                自分が担当する
              </Button>
            )}
          </Row>
          <Feedback at="assignee" notice={notice} error={failedAt === "assignee" ? update.error : null} />
        </Box>
      </Stack>
    </Section>
  );
}

/** 操作した欄のすぐ下に出す結果（成功・失敗） */
function Feedback({ at, notice, error }: { at: "status" | "assignee"; notice: { at: string; text: string } | null; error: unknown }) {
  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 1 }}>
        変えられませんでした：{errorMessage(error)}
      </Alert>
    );
  }
  return (
    <Box role="status" sx={{ mt: notice?.at === at ? 1 : 0 }}>
      {notice?.at === at && <Alert severity="success">{notice.text}</Alert>}
    </Box>
  );
}
