import Box from "@mui/material/Box";
import {
  ACTION_KINDS,
  describeAction,
  describeTrigger,
  ROUTINE_INSTRUCTION_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  TRIGGER_KINDS,
  type WorkflowAction,
  type WorkflowActionType,
  type WorkflowDraft,
  type WorkflowTrigger,
  type WorkflowTriggerType,
} from "@wiki/shared";
import { Bot, CalendarClock, Rocket, Tag, TagPlus, TagX, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HelpTip } from "../components/HelpTip";
import { Field } from "../components/ui";

/**
 * ワークフローの編集画面の、種類ごとの見せ方（アイコン・カードの要約・編集欄）。
 *
 * 種類を足すとき（`@wiki/shared` の `workflow.ts` の手順のあと）、ここの `TRIGGER_UI` / `ACTION_UI` に1件足す。
 * 型が `Record<種類, …>` なので、足し忘れると型エラーになる。あわせて `WorkflowBlocksSection.tsx` の
 * `draftToInput` / `blockToDraft`（編集の入力 ⇔ API の形）にも足す。
 */

/** 選ぶ欄に出す候補（タグ・Routine・担当者の ID と名前） */
export type Choice = { id: string; name: string };
/** `members`：「人の作業」の担当者にできる人（メンバーと、自分） */
export type Lookups = { tags: Choice[]; routines: Choice[]; members: Choice[] };

export type DraftActionFields = WorkflowDraft["actions"][number];

const nameOf = (list: Choice[], id: string) => (id ? list.find((x) => x.id === id)?.name : undefined);

type TriggerUi = {
  icon: LucideIcon;
  /** 選び終えていれば画面に出す形にする。足りない欄があれば null */
  fromDraft: (draft: WorkflowDraft, lookups: Lookups, pageTitle: string) => WorkflowTrigger | null;
};

export const TRIGGER_UI: Record<WorkflowTriggerType, TriggerUi> = {
  tag_attached: {
    icon: Tag,
    fromDraft: (d, l) => {
      const tagName = nameOf(l.tags, d.tagId);
      return tagName === undefined ? null : { type: "tag_attached", tagId: d.tagId, tagName };
    },
  },
  page_first_published: { icon: Rocket, fromDraft: () => ({ type: "page_first_published" }) },
  schedule: {
    icon: CalendarClock,
    fromDraft: (d, _l, pageTitle) => (d.pageId && d.time && d.weekdays.length > 0 ? { type: "schedule", pageId: d.pageId, pageTitle, time: d.time, weekdays: d.weekdays } : null),
  },
};

/** アクションの編集欄に渡すもの */
export type ActionFieldsProps = {
  /** 何番目か（1 から）。欄の名前に入れて、どのアクションの欄かを読み上げで分かるようにする */
  index: number;
  action: DraftActionFields;
  onChange: (patch: Partial<DraftActionFields>) => void;
  lookups: Lookups;
};

type ActionUi = {
  icon: LucideIcon;
  /** 選び終えていれば画面に出す形にする。足りない欄があれば null */
  fromDraft: (a: DraftActionFields, lookups: Lookups) => WorkflowAction | null;
  /** カードの要約の下に出す補足（Routine への依頼の先頭など）。無ければ null */
  detail: (a: DraftActionFields) => string | null;
  /** 種類の選択欄の下に出す、その種類だけの編集欄 */
  Fields: (props: ActionFieldsProps) => ReactNode;
};

/** 一覧に出す、依頼文の先頭（改行は空白にして、長ければ切る） */
export function instructionPreview(instruction: string, max = 60): string {
  const flat = instruction.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function ChoiceSelect({ label, value, list, disabled, onChange }: { label: string; value: string; list: Choice[]; disabled?: boolean; onChange: (id: string) => void }) {
  return (
    <Field select fullWidth label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} slotProps={{ select: { native: true } }}>
      <option value="">選んでください</option>
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </Field>
  );
}

const tagAction = (type: "add_tag" | "remove_tag", icon: LucideIcon, verb: string): ActionUi => ({
  icon,
  fromDraft: (a, l) => {
    const tagName = nameOf(l.tags, a.tagId);
    return tagName === undefined ? null : { type, tagId: a.tagId, tagName };
  },
  detail: () => null,
  Fields: ({ index, action, onChange, lookups }) => (
    <ChoiceSelect label={`${index} 番目の${verb}タグ`} value={action.tagId} list={lookups.tags} disabled={lookups.tags.length === 0} onChange={(tagId) => onChange({ tagId })} />
  ),
});

export const ACTION_UI: Record<WorkflowActionType, ActionUi> = {
  call_routine: {
    icon: Bot,
    fromDraft: (a, l) => {
      const routineName = nameOf(l.routines, a.routineId);
      return routineName === undefined ? null : { type: "call_routine", routineId: a.routineId, routineName, instruction: a.instruction };
    },
    detail: (a) => (a.instruction.trim() ? `依頼：${instructionPreview(a.instruction)}` : null),
    Fields: ({ index, action, onChange, lookups }) => (
      <>
        <ChoiceSelect label={`${index} 番目の Routine`} value={action.routineId} list={lookups.routines} onChange={(routineId) => onChange({ routineId })} />
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
          <Field
            multiline
            minRows={3}
            fullWidth
            label={`${index} 番目の Routine への依頼`}
            value={action.instruction}
            onChange={(e) => onChange({ instruction: e.target.value })}
            error={action.instruction.trim().length > ROUTINE_INSTRUCTION_MAX}
            helperText={`${action.instruction.trim().length} / ${ROUTINE_INSTRUCTION_MAX} 文字`}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <HelpTip about="Routine への依頼">
            Routine にしてほしいことを書きます（例：記事の下書きを書く、台本を作る）。この文のあとに、対象のページを示す値（ページの ID・タイトル・タグ名・版の ID・URL）が自動で付きます。本文は付かないので、Routine が wiki の MCP で読みます。保存したあとに積まれる実行から、新しい依頼で呼びます。
          </HelpTip>
        </Box>
      </>
    ),
  },
  remove_tag: tagAction("remove_tag", TagX, "外す"),
  add_tag: tagAction("add_tag", TagPlus, "付ける"),
  create_task: {
    icon: UserRoundCheck,
    fromDraft: (a, l) => {
      if (!a.title.trim()) return null;
      const assigneeName = a.assigneeId ? (nameOf(l.members, a.assigneeId) ?? "メンバーでない人") : null;
      return { type: "create_task", title: a.title.trim(), description: a.description.trim(), assigneeId: a.assigneeId || null, assigneeName };
    },
    detail: (a) => (a.description.trim() ? `説明：${instructionPreview(a.description)}` : null),
    Fields: ({ index, action, onChange, lookups }) => (
      <>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-start" }}>
          <Field
            fullWidth
            label={`${index} 番目のタスクの題`}
            value={action.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="例：ナレーションを録音する"
            error={action.title.trim().length > TASK_TITLE_MAX}
            helperText={`${action.title.trim().length} / ${TASK_TITLE_MAX} 文字`}
          />
          <HelpTip about="人の作業">
            ここまで進むと、対象のページのタスクを作り、実行を止めて待ちます。サイドバーの「タスク」でそのタスクを「完了」にすると、次のアクションから続きます。人が録音・撮影・確認などをしてから、次の工程（Routine やタグの付け替え）へ進めたいときに使います。
          </HelpTip>
        </Box>
        <Field
          multiline
          minRows={2}
          fullWidth
          label={`${index} 番目のタスクの説明（任意）`}
          value={action.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="例：台本のページを読み、声を録って音声を添付してください"
          error={action.description.trim().length > TASK_DESCRIPTION_MAX}
          helperText={`${action.description.trim().length} / ${TASK_DESCRIPTION_MAX} 文字`}
        />
        <Field
          select
          fullWidth
          label={`${index} 番目のタスクの担当者`}
          value={action.assigneeId}
          onChange={(e) => onChange({ assigneeId: e.target.value })}
          helperText="決めなければ、この wiki のメンバーなら誰でも拾って進められます。"
          slotProps={{ select: { native: true } }}
        >
          <option value="">担当者なし（メンバーの誰でも）</option>
          {lookups.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {action.assigneeId && !lookups.members.some((m) => m.id === action.assigneeId) && <option value={action.assigneeId}>メンバーでない人</option>}
        </Field>
      </>
    ),
  },
};

/** 要約の文と、選び終えているか。選び終えていなければ「種類の名前（未設定）」にする */
export type Summary = { text: string; complete: boolean };

/** 編集中のトリガーのカードに出す要約。選び終えていれば、一覧や監査ログと同じ文（`describeTrigger`） */
export function draftTriggerSummary(draft: WorkflowDraft, lookups: Lookups, pageTitle: string): Summary {
  const t = TRIGGER_UI[draft.triggerType].fromDraft(draft, lookups, pageTitle);
  return t ? { text: describeTrigger(t), complete: true } : { text: `${TRIGGER_KINDS[draft.triggerType].label}（未設定）`, complete: false };
}

/** 編集中のアクションのカードに出す要約。選び終えていれば、一覧と同じ文（`describeAction`） */
export function draftActionSummary(a: DraftActionFields, lookups: Lookups): Summary {
  const action = ACTION_UI[a.type].fromDraft(a, lookups);
  return action ? { text: describeAction(action), complete: true } : { text: `${ACTION_KINDS[a.type].label}（未設定）`, complete: false };
}
