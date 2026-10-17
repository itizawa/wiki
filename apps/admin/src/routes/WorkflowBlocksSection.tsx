import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import Autocomplete from "@mui/material/Autocomplete";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTION_KINDS,
  ACTION_TYPES,
  DEFAULT_ROUTINE_INSTRUCTION,
  describeAction,
  describeTrigger,
  TRIGGER_KINDS,
  TRIGGER_TYPES,
  WEEKDAY_LABELS,
  type WorkflowTriggerType,
  workflowDraftProblem,
  type WorkflowActionInput,
  type WorkflowActionType,
  type WorkflowBlock,
  type WorkflowBlockInput,
  type WorkflowDraft,
} from "@wiki/shared";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { HelpHeading, HelpTip } from "../components/HelpTip";
import { Field, Muted, RouterLink, Row, Section, SkeletonRows } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useSession } from "./Layout";
import { ACTION_UI, draftActionSummary, draftTriggerSummary, TRIGGER_UI, type Lookups } from "./workflowKinds";
import { FlowCard, FlowConnector } from "./WorkflowFlow";

/** ブロックの節の id（履歴が空のときの案内から、ここへ移る） */
export const BLOCKS_SECTION_ID = "workflow-blocks";
/** ワークフローの、ブロックの問い合わせの鍵。`["workflow"]` の下に置き、タグを変えたあとの取り直し（`invalidateAfterTagChange`）にも、ワークフロー一覧のブロック数にも効く */
const blocksKey = (workflowId: string) => ["workflow", workflowId, "blocks"];
const ROUTINES_KEY = ["routine-choices"];

/** 時刻で起動するときの、入力欄の初期値（毎日 9 時） */
const DEFAULT_SCHEDULE_TIME = "09:00";
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** 編集の入力 → API に送る形（選び終えていることは、呼ぶ前に `workflowDraftProblem` で確かめてある） */
export function draftToInput(draft: WorkflowDraft): WorkflowBlockInput {
  return {
    trigger:
      draft.triggerType === "tag_attached"
        ? { type: "tag_attached", tagId: draft.tagId }
        : draft.triggerType === "schedule"
          ? { type: "schedule", pageId: draft.pageId, time: draft.time, weekdays: [...draft.weekdays].sort((a, b) => a - b) }
          : { type: "page_first_published" },
    actions: draft.actions.map((a): WorkflowActionInput => (a.type === "call_routine" ? { type: "call_routine", routineId: a.routineId, instruction: a.instruction.trim() } : { type: a.type, tagId: a.tagId })),
  };
}

export function blockToDraft(block: WorkflowBlock): WorkflowDraft {
  return {
    triggerType: block.trigger.type,
    tagId: block.trigger.type === "tag_attached" ? block.trigger.tagId : "",
    pageId: block.trigger.type === "schedule" ? block.trigger.pageId : "",
    time: block.trigger.type === "schedule" ? block.trigger.time : DEFAULT_SCHEDULE_TIME,
    weekdays: block.trigger.type === "schedule" ? block.trigger.weekdays : ALL_WEEKDAYS,
    actions: block.actions.map((a) => ({
      type: a.type,
      routineId: a.type === "call_routine" ? a.routineId : "",
      tagId: a.type === "call_routine" ? "" : a.tagId,
      instruction: a.type === "call_routine" ? a.instruction : "",
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

/** 1ブロック＝1枚の枠。中に、トリガーのカード → アクションのカードを、矢印でつないで縦に並べる（読むだけ。編集はダイアログで） */
function BlockCard({ block, busy, onEdit, onDelete }: { block: WorkflowBlock; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  const label = describeTrigger(block.trigger);
  const drafts = blockToDraft(block).actions;
  return (
    <Box
      component="li"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "space-between" }}
    >
      <Box sx={{ minWidth: 0, flex: "1 1 280px", maxWidth: 560 }}>
        <FlowCard
          dense
          tone="trigger"
          icon={TRIGGER_UI[block.trigger.type].icon}
          kind="トリガー"
          summary={label}
          detail={block.trigger.type === "schedule" ? `対象：「${block.trigger.pageTitle}」` : null}
        />
        <Box component="ol" aria-label={`${label}のアクション`} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {block.actions.map((a, i) => (
            <li key={i}>
              <FlowConnector dense />
              <FlowCard dense icon={ACTION_UI[a.type].icon} kind={`${i + 1} 番目のアクション`} summary={describeAction(a)} detail={ACTION_UI[a.type].detail(drafts[i]!)} />
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

/** 時刻で起動するときの、対象のページを選ぶ欄。打った語で検索し、語が無いときは最近更新したページを出す */
function SchedulePagePicker({ value, onChange }: { value: { id: string; title: string } | null; onChange: (page: { id: string; title: string } | null) => void }) {
  const [input, setInput] = useState("");
  const results = useQuery({ queryKey: ["workflow-schedule-pages", input], queryFn: () => api.search(input.trim()), placeholderData: (prev) => prev });
  const options = (results.data?.results ?? []).map((r) => ({ id: r.id, title: r.title }));
  return (
    <Autocomplete
      size="small"
      options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
      value={value}
      getOptionLabel={(o) => o.title || "（無題）"}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(xs) => xs}
      onChange={(_, p) => onChange(p)}
      onInputChange={(_, v, reason) => reason === "input" && setInput(v)}
      loading={results.isFetching}
      loadingText="検索しています…"
      noOptionsText="見つかるページがありません"
      renderInput={(params) => <Field {...params} label="対象のページ" placeholder="ページのタイトルで探す" />}
    />
  );
}

/** つまみ（GripVertical）だけを掴めるようにして、行の中の選択欄は今までどおり操作できるようにする */
function SortableItem({ id, label, children }: { id: number; label: string; children: (handle: ReactNode) => ReactNode }) {
  const sortable = useSortable({ id });
  const handle = (
    <IconButton
      size="small"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      aria-label={label}
      sx={{ cursor: "grab", touchAction: "none", color: "text.secondary" }}
    >
      <GripVertical size={18} />
    </IconButton>
  );
  return (
    <Box
      component="li"
      ref={sortable.setNodeRef}
      style={{ transform: sortable.transform ? `translate3d(0, ${sortable.transform.y}px, 0)` : undefined, transition: sortable.transition }}
      sx={[sortable.isDragging && { position: "relative", zIndex: 1, opacity: 0.7 }]}
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
  const initial: WorkflowDraft = block ? blockToDraft(block) : { triggerType: "tag_attached", tagId: "", pageId: "", time: DEFAULT_SCHEDULE_TIME, weekdays: ALL_WEEKDAYS, actions: [] };
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>(initial.triggerType);
  const [tagId, setTagId] = useState(initial.tagId);
  const [pageId, setPageId] = useState(initial.pageId);
  const [pageTitle, setPageTitle] = useState(block?.trigger.type === "schedule" ? block.trigger.pageTitle : "");
  const [time, setTime] = useState(initial.time);
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [actions, setActions] = useState<DraftAction[]>(() => initial.actions.map(withKey));
  // 開いているカード。作るときはトリガーから開き、編集のときは全部閉じて、流れを先に見せる。
  // アクションは添字でなく key で持つ（並べ替えても、開いているカードが入れ替わらない）
  const [triggerOpen, setTriggerOpen] = useState(block === null);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<number>>(() => new Set());
  const toggleOpen = (key: number) =>
    setOpenKeys((ks) => {
      const next = new Set(ks);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  const draft: WorkflowDraft = { triggerType, tagId, pageId, time, weekdays, actions };
  const problem = workflowDraftProblem(draft);
  const change = (key: number, patch: Partial<DraftAction>) => {
    setActions((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    save.reset();
  };
  const addAction = () => {
    const added = withKey(routineList.length > 0 ? { type: "call_routine", routineId: "", tagId: "", instruction: DEFAULT_ROUTINE_INSTRUCTION } : { type: "remove_tag", routineId: "", tagId: "", instruction: "" });
    setActions((xs) => [...xs, added]);
    // 足したカードは、すぐ選べるように開いておく
    setOpenKeys((ks) => new Set(ks).add(added.key));
    save.reset();
  };
  const lookups: Lookups = { tags: tagList, routines: routineList };
  const triggerSummary = draftTriggerSummary(draft, lookups, pageTitle);

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

          <FlowCard
            tone="trigger"
            icon={TRIGGER_UI[triggerType].icon}
            kind="トリガー"
            summary={triggerSummary.text}
            incomplete={!triggerSummary.complete}
            expanded={triggerOpen}
            onToggle={() => setTriggerOpen((o) => !o)}
            end={
              <HelpTip about="トリガーの種類">
                「タグが付いたとき」は、選んだタグがページに付くたびに動きます。「初めて公開されたとき」は、一度も公開したことのないページを、公開か限定公開にしたときだけ動きます（公開し直し・非公開にしたときは動きません）。管理画面・MCP・予約のどれから公開しても動きます。「決まった時刻になったとき」は、選んだ曜日の時刻（日本時間）が来たあとの最初の確認（5分おき）で、選んだページを対象に1回だけ動きます（同じブロックの実行は、1時間に5回までです）。タグがトリガーでないとき、Routine に渡す値のタグ名は、空になります。
              </HelpTip>
            }
          >
            <Field
              select
              fullWidth
              label="きっかけ"
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value as WorkflowTriggerType);
                save.reset();
              }}
              slotProps={{ select: { native: true } }}
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_KINDS[t].label}
                </option>
              ))}
            </Field>
            {triggerType === "tag_attached" && (
              <Field
                select
                fullWidth
                label="このタグ"
                value={tagId}
                disabled={noTags}
                onChange={(e) => {
                  setTagId(e.target.value);
                  save.reset();
                }}
                slotProps={{ select: { native: true } }}
              >
                <option value="">選んでください</option>
                {tagList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Field>
            )}

            {triggerType === "schedule" && (
              <>
                <SchedulePagePicker
                  value={pageId ? { id: pageId, title: pageTitle } : null}
                  onChange={(p) => {
                    setPageId(p?.id ?? "");
                    setPageTitle(p?.title ?? "");
                    save.reset();
                  }}
                />
                <Field
                  type="time"
                  label="時刻（日本時間）"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    save.reset();
                  }}
                  helperText="5分おきに確認するので、数分遅れて動くことがあります。"
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ maxWidth: 240 }}
                />
                <FormControl component="fieldset" variant="standard">
                  <FormLabel component="legend" sx={{ fontSize: 12 }}>
                    曜日
                  </FormLabel>
                  <FormGroup row>
                    {WEEKDAY_LABELS.map((label, day) => (
                      <FormControlLabel
                        key={day}
                        label={label}
                        control={
                          <Checkbox
                            size="small"
                            checked={weekdays.includes(day)}
                            onChange={(e) => {
                              setWeekdays((ds) => (e.target.checked ? [...ds, day] : ds.filter((d) => d !== day)));
                              save.reset();
                            }}
                          />
                        }
                      />
                    ))}
                  </FormGroup>
                </FormControl>
              </>
            )}
          </FlowCard>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={actions.map((a) => a.key)} strategy={verticalListSortingStrategy}>
              <Box component="ol" aria-label="アクション（上から順に行う）" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {actions.map((a, i) => {
                  const ui = ACTION_UI[a.type];
                  const summary = draftActionSummary(a, lookups);
                  const n = i + 1;
                  return (
                    <SortableItem key={a.key} id={a.key} label={`${n} 番目のアクションをドラッグして順番を変える`}>
                      {(handle) => (
                        <>
                          <FlowConnector />
                          <FlowCard
                            icon={ui.icon}
                            kind={`${n} 番目のアクション`}
                            summary={summary.text}
                            detail={ui.detail(a)}
                            incomplete={!summary.complete}
                            expanded={openKeys.has(a.key)}
                            onToggle={() => toggleOpen(a.key)}
                            start={handle}
                            wrapEnd
                            end={
                              <Row sx={{ flexWrap: "nowrap", gap: 0 }}>
                                <IconButton size="small" aria-label={`${n} 番目のアクションを上へ`} disabled={i === 0} onClick={() => setActions((xs) => moveItem(xs, i, -1))}>
                                  <ArrowUp size={18} />
                                </IconButton>
                                <IconButton size="small" aria-label={`${n} 番目のアクションを下へ`} disabled={i === actions.length - 1} onClick={() => setActions((xs) => moveItem(xs, i, 1))}>
                                  <ArrowDown size={18} />
                                </IconButton>
                                {/* 取り除くは、並べ替えから少し離す */}
                                <IconButton size="small" aria-label={`${n} 番目のアクションを取り除く`} onClick={() => setActions((xs) => xs.filter((x) => x.key !== a.key))} sx={{ ml: 1 }}>
                                  <X size={18} />
                                </IconButton>
                              </Row>
                            }
                          >
                            <Field
                              select
                              fullWidth
                              label={`${n} 番目の種類`}
                              value={a.type}
                              onChange={(e) => {
                                const type = e.target.value as WorkflowActionType;
                                // 「Routine を呼ぶ」に変えたとき、依頼が空なら初期値を入れる
                                change(a.key, { type, routineId: "", tagId: "", instruction: type === "call_routine" && !a.instruction ? DEFAULT_ROUTINE_INSTRUCTION : a.instruction });
                              }}
                              slotProps={{ select: { native: true } }}
                            >
                              {ACTION_TYPES.map((t) => (
                                <option key={t} value={t} disabled={t === "call_routine" && noRoutines && a.type !== t}>
                                  {ACTION_KINDS[t].label}
                                </option>
                              ))}
                            </Field>
                            <ui.Fields index={n} action={a} lookups={lookups} onChange={(patch) => change(a.key, patch)} />
                          </FlowCard>
                        </>
                      )}
                    </SortableItem>
                  );
                })}
              </Box>
            </SortableContext>
          </DndContext>
          <FlowConnector />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Button variant="outlined" startIcon={<Plus size={18} />} onClick={addAction} sx={{ flex: 1, borderStyle: "dashed", py: 1 }}>
              アクションを足す
            </Button>
            <HelpTip about="アクションの順番">
              上から順に行います。「タグを外す」を最後に置くと、ほかのアクションを行ったあとにタグが外れます。カードの左のつまみをドラッグするか、上へ・下へのボタンで順番を入れ替えられます。カードを押すと、編集欄が開きます。
            </HelpTip>
          </Box>
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
