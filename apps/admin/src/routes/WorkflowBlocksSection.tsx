import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTION_KINDS,
  ACTION_TYPES,
  describeAction,
  describeTrigger,
  describeTriggerCondition,
  workflowDraftProblem,
  type WorkflowActionInput,
  type WorkflowActionType,
  type WorkflowBlock,
  type WorkflowBlockInput,
  type WorkflowDraft,
} from "@wiki/shared";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Muted, Row, RouterLink, Section, SkeletonRows } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useSession } from "./Layout";

/** ブロックの節の id（履歴が空のときの案内から、ここへ移る） */
export const BLOCKS_SECTION_ID = "workflow-blocks";
/** ワークフローの、ブロックの問い合わせの鍵。`["workflow"]` の下に置き、タグを変えたあとの取り直し（`invalidateAfterTagChange`）にも、ワークフロー一覧のブロック数にも効く */
const blocksKey = (workflowId: string) => ["workflow", workflowId, "blocks"];
const ROUTINES_KEY = ["routine-choices"];

/** 編集の入力 → API に送る形（選び終えていることは、呼ぶ前に `workflowDraftProblem` で確かめてある） */
export function draftToInput(draft: WorkflowDraft): WorkflowBlockInput {
  return {
    trigger: { type: "tag_attached", tagId: draft.tagId },
    actions: draft.actions.map((a): WorkflowActionInput => (a.type === "call_routine" ? { type: "call_routine", routineId: a.routineId } : { type: a.type, tagId: a.tagId })),
  };
}

export function blockToDraft(block: WorkflowBlock): WorkflowDraft {
  return {
    tagId: block.trigger.tagId,
    actions: block.actions.map((a) => ({
      type: a.type,
      routineId: a.type === "call_routine" ? a.routineId : "",
      tagId: a.type === "call_routine" ? "" : a.tagId,
    })),
  };
}

/** 配列の i 番目を、上（-1）か下（+1）と入れ替えた新しい配列。端では、そのまま返す */
export function moveItem<T>(items: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** 削除の確認に出す文 */
export function deleteBlockBody(block: WorkflowBlock): string {
  return `「${describeTrigger(block.trigger)}」のブロック（アクション ${block.actions.length} 件）だけが消えます。タグと Routine は消えません。元に戻せません。`;
}

/** 「ブロック」の節：そのワークフローのブロックの一覧と、作る・編集・削除。実行はまだしない（設定を保存するところまで）。 */
export function WorkflowBlocksSection({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: blocksKey(workflowId), queryFn: () => api.getWorkflowBlocks(workflowId) });
  // null：開いていない／"new"：作る／ブロック：その編集
  const [editing, setEditing] = useState<WorkflowBlock | "new" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (b: WorkflowBlock) => api.deleteWorkflowBlock(workflowId, b.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workflow"] });
      setDone("ブロックを削除しました。");
    },
  });

  const askDelete = async (b: WorkflowBlock) => {
    const ok = await confirmDialog({
      title: "このブロックを削除しますか？",
      body: deleteBlockBody(b),
      confirmLabel: "削除する",
      cancelLabel: "削除せずに戻る",
      danger: true,
    });
    if (ok) {
      setDone(null);
      remove.reset();
      remove.mutate(b);
    }
  };

  const blocks = list.data?.blocks;

  return (
    <Section id={BLOCKS_SECTION_ID}>
      <HelpHeading
        variant="subtitle1"
        component="h2"
        sx={{ mb: 1 }}
        help="1つのブロックは、1つのトリガー（きっかけ）と、上から順に行うアクションの並びです。ブロック同士は独立していて、順番に意味はありません。いまは、設定を保存できるだけで、動かすのは別の機能です。「タグを外す」を最後に置くと、ほかのアクションを行ったあとにタグが外れます。"
      >
        ブロック
      </HelpHeading>
      <Box sx={{ mb: 1.5 }}>
        <Button variant="contained" onClick={() => setEditing("new")}>
          ブロックを作る
        </Button>
      </Box>
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
          {done}
        </Alert>
      )}
      {remove.error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          削除できませんでした：{errorMessage(remove.error)}
        </Alert>
      )}
      {list.error && <Alert severity="error">ブロックを読み込めませんでした：{errorMessage(list.error)}</Alert>}
      {!blocks && !list.error && <SkeletonRows rows={2} height={64} label="ブロックを読み込み中" />}
      {blocks && blocks.length === 0 && <Muted>ブロックはまだありません。「ブロックを作る」から作ってください。</Muted>}
      {blocks && blocks.length > 0 && (
        <Box component="ul" aria-label="ブロック" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
          {blocks.map((b) => (
            <BlockCard key={b.id} block={b} busy={remove.isPending} onEdit={() => setEditing(b)} onDelete={() => askDelete(b)} />
          ))}
        </Box>
      )}
      {editing && (
        <BlockDialog
          workflowId={workflowId}
          block={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setDone(message);
          }}
        />
      )}
    </Section>
  );
}

/** 1ブロック＝1枚のカード。「タグ『…』が付いたら」→ アクションの並び、を文で読める形で出す */
function BlockCard({ block, busy, onEdit, onDelete }: { block: WorkflowBlock; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  const label = describeTrigger(block.trigger);
  return (
    <Box
      component="li"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "space-between" }}
    >
      <Box sx={{ minWidth: 0, flex: "1 1 240px" }}>
        <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{describeTriggerCondition(block.trigger)}</Typography>
        <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 3, color: "text.primary" }}>
          {block.actions.map((a, i) => (
            <li key={i}>
              <Typography component="span" sx={{ overflowWrap: "anywhere" }}>
                {describeAction(a)}
              </Typography>
            </li>
          ))}
        </Box>
      </Box>
      {/* 取り返しのつかない操作（削除）は、ほかの操作から離して置く */}
      <Row sx={{ flexWrap: "nowrap" }}>
        <Button variant="outlined" aria-label={`${label}のブロックを編集`} onClick={onEdit} sx={{ whiteSpace: "nowrap" }}>
          編集
        </Button>
        <Button variant="outlined" color="error" aria-label={`${label}のブロックを削除`} disabled={busy} onClick={onDelete} sx={{ ml: 3, whiteSpace: "nowrap" }}>
          削除
        </Button>
      </Row>
    </Box>
  );
}

/** つまみ（GripVertical）だけを掴めるようにして、行の中の選択欄は今までどおり操作できるようにする */
function SortableItem({ id, children }: { id: number; children: (handle: ReactNode) => ReactNode }) {
  const sortable = useSortable({ id });
  const handle = (
    <IconButton
      size="small"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      aria-label="ドラッグして順番を変える"
      sx={{ cursor: "grab", touchAction: "none", mt: 0.25 }}
    >
      <GripVertical size={18} />
    </IconButton>
  );
  return (
    <Box
      component="li"
      ref={sortable.setNodeRef}
      style={{ transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined, transition: sortable.transition }}
      sx={[{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap", bgcolor: "background.paper" }, sortable.isDragging && { position: "relative", zIndex: 1, opacity: 0.7 }]}
    >
      {children(handle)}
    </Box>
  );
}

type DraftAction = WorkflowDraft["actions"][number] & { key: number };

/** 作る・編集のダイアログ。選び終えていない欄があれば、保存ボタンの横に理由を出す */
function BlockDialog({ workflowId, block, onClose, onDone }: { workflowId: string; block: WorkflowBlock | null; onClose: () => void; onDone: (message: string) => void }) {
  const qc = useQueryClient();
  const { isOwner } = useSession();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const routines = useQuery({ queryKey: ROUTINES_KEY, queryFn: api.listRoutineChoices });
  const nextKey = useRef(0);
  const withKey = (a: WorkflowDraft["actions"][number]): DraftAction => ({ ...a, key: nextKey.current++ });
  const initial = block ? blockToDraft(block) : { tagId: "", actions: [] };
  const [tagId, setTagId] = useState(initial.tagId);
  const [actions, setActions] = useState<DraftAction[]>(() => initial.actions.map(withKey));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setActions((xs) => arrayMove(xs, xs.findIndex((x) => x.key === e.active.id), xs.findIndex((x) => x.key === e.over!.id)));
    save.reset();
  };

  const tagList = tags.data?.tags ?? [];
  const routineList = routines.data?.routines ?? [];
  const noTags = tags.data !== undefined && tagList.length === 0;
  const noRoutines = routines.data !== undefined && routineList.length === 0;

  const save = useMutation({
    mutationFn: (input: WorkflowBlockInput) => (block ? api.replaceWorkflowBlock(workflowId, block.id, input) : api.createWorkflowBlock(workflowId, input)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["workflow"] });
      onDone(block ? "ブロックを保存しました。" : "ブロックを作りました。");
    },
  });

  const draft: WorkflowDraft = { tagId, actions };
  const problem = workflowDraftProblem(draft);
  const change = (key: number, patch: Partial<DraftAction>) => {
    setActions((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    save.reset();
  };
  const addAction = () => {
    setActions((xs) => [...xs, withKey({ type: routineList.length > 0 ? "call_routine" : "remove_tag", routineId: "", tagId: "" })]);
    save.reset();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="workflow-block-title">
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (problem === null && !save.isPending) save.mutate(draftToInput(draft));
        }}
      >
        <DialogTitle id="workflow-block-title">{block ? "ブロックを編集" : "ブロックを作る"}</DialogTitle>
        <DialogContent>
          {noTags && (
            <Alert severity="info" sx={{ mb: 2 }}>
              タグがまだありません。いったん閉じて、このページの「タグ」の節でタグを作ってください。
            </Alert>
          )}
          {noRoutines && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Routine がまだ登録されていないため、「Routine を呼ぶ」は選べません。
              {isOwner ? (
                <>
                  {" "}
                  <RouterLink to="/routines">「全体の管理」の「Routine」</RouterLink>で登録してください。
                </>
              ) : (
                " オーナーが「全体の管理」の「Routine」で登録します。"
              )}
            </Alert>
          )}

          <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
            トリガー
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            label="タグが付いたとき（このタグ）"
            value={tagId}
            disabled={noTags}
            onChange={(e) => {
              setTagId(e.target.value);
              save.reset();
            }}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            <option value="">選んでください</option>
            {tagList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </TextField>

          <Row sx={{ mt: 2.5, mb: 1, gap: 0.5 }}>
            <Typography variant="subtitle2" component="h3">
              アクション（上から順に行う）
            </Typography>
            <HelpTip about="アクションの順番">
              上から順に行います。「タグを外す」を最後に置くと、ほかのアクションを行ったあとにタグが外れます。左のつまみをドラッグするか、上へ・下へのボタンで順番を入れ替えられます。
            </HelpTip>
          </Row>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={actions.map((a) => a.key)} strategy={verticalListSortingStrategy}>
            <Box component="ol" aria-label="アクション" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1.5 }}>
              {actions.map((a, i) => (
                <SortableItem key={a.key} id={a.key}>
                  {(handle) => (
                    <>
                      {handle}
                      <Typography sx={{ width: 20, pt: 0.75, textAlign: "right", color: "text.secondary" }} aria-hidden>
                        {i + 1}
                      </Typography>
                      <TextField
                        select
                        size="small"
                        label={`${i + 1} 番目の種類`}
                        value={a.type}
                        onChange={(e) => change(a.key, { type: e.target.value as WorkflowActionType, routineId: "", tagId: "" })}
                        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                        sx={{ width: 170 }}
                      >
                        {ACTION_TYPES.map((t) => (
                          <option key={t} value={t} disabled={t === "call_routine" && noRoutines && a.type !== t}>
                            {ACTION_KINDS[t].label}
                          </option>
                        ))}
                      </TextField>
                      {a.type === "call_routine" ? (
                        <TextField
                          select
                          size="small"
                          label={`${i + 1} 番目の Routine`}
                          value={a.routineId}
                          onChange={(e) => change(a.key, { routineId: e.target.value })}
                          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                          sx={{ flex: "1 1 160px", minWidth: 140 }}
                        >
                          <option value="">選んでください</option>
                          {routineList.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </TextField>
                      ) : (
                        <TextField
                          select
                          size="small"
                          label={`${i + 1} 番目の${a.type === "add_tag" ? "付ける" : "外す"}タグ`}
                          value={a.tagId}
                          disabled={noTags}
                          onChange={(e) => change(a.key, { tagId: e.target.value })}
                          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                          sx={{ flex: "1 1 160px", minWidth: 140 }}
                        >
                          <option value="">選んでください</option>
                          {tagList.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </TextField>
                      )}
                      <Row sx={{ flexWrap: "nowrap", gap: 0 }}>
                        <IconButton size="small" aria-label={`${i + 1} 番目のアクションを上へ`} disabled={i === 0} onClick={() => setActions((xs) => moveItem(xs, i, -1))}>
                          <ArrowUp size={18} />
                        </IconButton>
                        <IconButton size="small" aria-label={`${i + 1} 番目のアクションを下へ`} disabled={i === actions.length - 1} onClick={() => setActions((xs) => moveItem(xs, i, 1))}>
                          <ArrowDown size={18} />
                        </IconButton>
                        <IconButton size="small" aria-label={`${i + 1} 番目のアクションを取り除く`} onClick={() => setActions((xs) => xs.filter((x) => x.key !== a.key))}>
                          <X size={18} />
                        </IconButton>
                      </Row>
                    </>
                  )}
                </SortableItem>
              ))}
            </Box>
            </SortableContext>
          </DndContext>
          <Button variant="outlined" onClick={addAction} sx={{ mt: 1.5 }}>
            アクションを足す
          </Button>
          {save.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              保存できませんでした：{errorMessage(save.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap" }}>
          {problem && (
            <Typography variant="body2" color="text.secondary" role="status" sx={{ flex: "1 1 100%", mb: 0.5 }}>
              保存できません：{problem}
            </Typography>
          )}
          <Button onClick={onClose}>保存せずに閉じる</Button>
          <Button type="submit" variant="contained" disabled={problem !== null || save.isPending}>
            {save.isPending ? "保存しています…" : block ? "保存する" : "作る"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
