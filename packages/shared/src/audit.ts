import { z } from "zod";
import type { Visibility } from "./page";
import type { PublishVisibility } from "./publish";
import { WIKI_ROLE_LABELS, type WikiRole } from "./users";
import { ROUTINE_FAILURE_MESSAGES, type RoutineFailureReason } from "./routine";
import { SNS_PROVIDER_LABELS, type SnsProvider } from "./sns";

/**
 * 監査ログ：「誰が・いつ・何をしたか」を、あとから確かめるための記録。追記だけで、直したり消したりしない。
 * 本文の保存と、並べ替え・移動・ページの作成は、ここには入れない（本文の保存は版履歴に「誰が」を残す。並べ替え・移動・作成は記録しない）。
 */

export const AUDIT_CATEGORIES = ["login", "member", "publish", "page", "settings", "wiki"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  login: "ログイン",
  member: "メンバー",
  publish: "公開",
  page: "ページ",
  settings: "設定",
  wiki: "wiki",
};

/** 操作の種類と、その分類。 */
export const AUDIT_ACTIONS = {
  login: "login",
  login_denied: "login",
  logout: "login",
  logout_others: "login",

  invite_create: "member",
  invite_accept: "member",
  invite_revoke: "member",
  member_role_change: "member",
  member_remove: "member",
  member_leave: "member",
  owner_add: "member",
  owner_remove: "member",

  page_publish: "publish",
  page_unpublish: "publish",
  page_visibility_change: "publish",
  unlisted_key_rotate: "publish",
  page_auto_publish_change: "publish",
  wiki_site_visibility: "publish",
  schedule_create: "publish",
  schedule_update: "publish",
  schedule_cancel: "publish",
  schedule_run: "publish",
  schedule_fail: "publish",

  page_delete: "page",
  page_restore: "page",
  page_purge: "page",
  page_tag_add: "page",
  page_tag_remove: "page",
  page_audio_upload: "page",
  page_audio_delete: "page",
  voice_transcribe: "page",
  workflow_run_fail: "page",

  wiki_update: "settings",
  wiki_home_update: "settings",
  sns_connect: "settings",
  sns_disconnect: "settings",
  sns_test_post: "settings",
  tag_create: "settings",
  tag_rename: "settings",
  tag_delete: "settings",
  routine_create: "settings",
  routine_update: "settings",
  routine_delete: "settings",
  routine_test: "settings",
  workflow_create: "settings",
  workflow_rename: "settings",
  workflow_delete: "settings",
  workflow_block_create: "settings",
  workflow_block_update: "settings",
  workflow_block_delete: "settings",

  wiki_create: "wiki",
  wiki_archive: "wiki",
  wiki_unarchive: "wiki",
} as const satisfies Record<string, AuditCategory>;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** 分類に入る操作。 */
export function actionsIn(category: AuditCategory): AuditAction[] {
  return (Object.keys(AUDIT_ACTIONS) as AuditAction[]).filter((a) => AUDIT_ACTIONS[a] === category);
}

/** user：人／system：システム（予約の実行） */
export const AUDIT_ACTOR_TYPES = ["user", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_TARGET_TYPES = ["page", "user", "invite", "wiki", "tag", "routine", "workflow", "workflow_block"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** 予約を入れたのは誰か（予約の実行に残す）。 */
export type AuditScheduledBy = { type: "user"; userId: string; label: string } | null;

type ScheduleRef = {
  scheduleId: string;
  actionType: "publish_page" | "unpublish_page";
  runAt: string;
  visibility?: PublishVisibility;
};

/** 操作ごとの「変更の前と後」など。本文・招待リンクやトークンの値・シークレットは入れない。 */
export type AuditDetailMap = {
  login: Record<string, never>;
  login_denied: { reason: "invite_only" | "unverified" };
  logout: Record<string, never>;
  /** 切ったほかの端末のセッションの数 */
  logout_others: { count: number };

  invite_create: { role: WikiRole };
  invite_accept: { role: WikiRole };
  invite_revoke: { role: WikiRole };
  member_role_change: { from: WikiRole; to: WikiRole };
  member_remove: { role: WikiRole };
  member_leave: { role: WikiRole };
  owner_add: Record<string, never>;
  owner_remove: Record<string, never>;

  page_publish: {
    versionId: string;
    visibility: PublishVisibility;
    from: { visibility: Visibility; versionId: string | null };
    /** 配下もまとめて同じ公開範囲にしたページの数 */
    descendants?: number;
    /** 「自動で公開」の設定で、Cron が公開したもの（実行した主体はシステム） */
    auto?: true;
  };
  page_auto_publish_change: { enabled: boolean };
  page_unpublish: { from: Visibility; descendants?: number };
  page_visibility_change: { from: Visibility; to: Visibility; descendants?: number };
  unlisted_key_rotate: Record<string, never>;
  schedule_create: ScheduleRef & { versionId?: string };
  schedule_update: ScheduleRef & { from: string };
  schedule_cancel: ScheduleRef;
  schedule_run: ScheduleRef & { scheduledBy: AuditScheduledBy };
  schedule_fail: ScheduleRef & { scheduledBy: AuditScheduledBy; error: string };

  /** ゴミ箱に入れた。descendants：いっしょに入れた配下のページの数 */
  page_delete: { descendants?: number };
  /** ゴミ箱から元に戻した */
  page_restore: { descendants?: number };
  /** ゴミ箱から完全に削除した（元に戻せない） */
  page_purge: { descendants?: number };

  /** ページにタグを付けた・外した（タグの名前は、その時点のもの） */
  page_tag_add: { tagId: string; tagName: string };
  /** runId：ワークフローの実行が外したとき、その実行の ID */
  page_tag_remove: { tagId: string; tagName: string; runId?: string };
  /** ページに音声を添付した・外した（ファイル名は、その時点のもの。中身は残さない） */
  page_audio_upload: { name: string; bytes: number };
  page_audio_delete: { name: string };
  /** 音声入力で書き起こした（回数の上限を数えるために残す。音声も書き起こした文も残さない） */
  voice_transcribe: { bytes: number };

  wiki_update: { name?: { from: string; to: string }; iconUrl?: { from: string | null; to: string | null } };
  /** 公開サイトのトップの自由記述を変えた（中身は残さない） */
  wiki_home_update: Record<string, never>;
  /** 公開サイトを公開・非公開にした。sitePublic は変えたあとの状態 */
  wiki_site_visibility: { key: string; sitePublic: boolean };
  /** SNS のアカウントをつないだ・外した。トークンは入れない */
  sns_connect: { provider: SnsProvider; username: string };
  sns_disconnect: { provider: SnsProvider; username: string };
  /** 管理画面からテスト投稿をした（文面は残さない） */
  sns_test_post: { provider: SnsProvider; username: string; postId: string };

  /** 管理用タグを作った・名前を変えた・消した。消したときの pages は、外れたページの数 */
  /** ワークフローの実行が、失敗で確定した（再試行の上限・再試行できない失敗）。対象はページ。理由は500文字まで。トークンと相手の応答の本文は入れない */
  workflow_run_fail: { runId: string; blockId: string | null; actionType: string; error: string };

  tag_create: Record<string, never>;
  tag_rename: { from: string; to: string };
  tag_delete: { pages: number; blocks?: number };
  /** ワークフローの作成・名前の変更・削除。対象名はワークフローの名前。消したときは、いっしょに消えたブロックと実行の履歴の数を残す */
  workflow_create: Record<string, never>;
  workflow_rename: { from: string; to: string };
  workflow_delete: { blocks: number; runs: number };
  /** ワークフローのブロックの作成・変更・削除。対象名はトリガーの文、detail は入れたアクションの数。タグの削除に伴う削除は reason を付ける */
  workflow_block_create: { actions: number };
  workflow_block_update: { actions: number };
  workflow_block_delete: { reason?: "tag_deleted" };

  /** Routine（全体）を登録した・変えた・消した・テスト実行した。トークンの値は入れない（変えたかどうかだけ）。テスト実行の失敗は、理由だけ残す */
  routine_create: Record<string, never>;
  routine_update: { name?: { from: string; to: string }; url?: boolean; token?: boolean };
  routine_delete: Record<string, never>;
  routine_test: { ok: true } | { ok: false; reason: RoutineFailureReason };

  wiki_create: { key: string };
  wiki_archive: { key: string };
  wiki_unarchive: { key: string };
};

/** 一覧の1件。名前・メールアドレス・対象のタイトルは、その時点の値。 */
export type AuditLogEntry = {
  [A in AuditAction]: {
    id: string;
    /** 全体にかかわる操作（ログイン・オーナーの変更・wiki の作成とアーカイブ）は null */
    wiki: { key: string; name: string } | null;
    actor: {
      type: AuditActorType;
      userId: string | null;
      /** 人なら名前（無ければメールアドレス）、システムなら「システム」 */
      label: string;
      email: string | null;
      /** 外部のアプリ（MCP）からの操作なら、そのアプリの名前 */
      via: string | null;
    };
    action: A;
    category: AuditCategory;
    target: { type: AuditTargetType; id: string | null; label: string | null } | null;
    /** 対象のページがいまも開けるか（開けるならリンクにする） */
    targetAvailable: boolean;
    detail: AuditDetailMap[A];
    /** ログイン・ログインの拒否のときだけ */
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  };
}[AuditAction];

export type AuditActorOption = { userId: string; label: string; email: string | null };

export type AuditLogPage = { entries: AuditLogEntry[]; nextCursor: string | null };

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * 一覧の絞り込み。from / to は JST の日付（to の日を含む）。cursor は前のページの nextCursor。
 * wiki はオーナーの一覧だけ（"global" は全体にかかわるもの）。
 */
export const auditLogQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  actor: z.string().uuid().optional(),
  category: auditCategorySchema.optional(),
  wiki: z.string().min(1).max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

// ---------------------------------------------------------------------------
// 画面に出す文
// ---------------------------------------------------------------------------

/** 文の切れ目。target が立っている所は、対象（ページならリンクにする）。 */
export type AuditSentence = { text: string; target?: boolean }[];

const VISIBILITY_LABELS: Record<Visibility, string> = { public: "公開", unlisted: "限定公開", private: "非公開" };
const DENIED_LABELS: Record<AuditDetailMap["login_denied"]["reason"], string> = {
  invite_only: "招待されていない",
  unverified: "メールアドレスが未確認",
};

const jstFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 監査ログの日時（JST、桁を揃える）：2026/10/10 09:05 */
export function formatAuditTime(iso: string): string {
  return jstFmt.format(new Date(iso));
}

const quoted = (label: string | null | undefined): AuditSentence => [{ text: "「" }, { text: label ?? "（不明）", target: true }, { text: "」" }];
const plain = (text: string): AuditSentence => [{ text }];
const named = (label: string | null | undefined): AuditSentence => [{ text: label ?? "（不明）", target: true }];

function scheduleKind(d: ScheduleRef): string {
  return d.actionType === "publish_page" ? `${VISIBILITY_LABELS[d.visibility ?? "public"]}の予約` : "非公開化の予約";
}

/** 「誰が」を除いた、何をしたかの文。例：「はじめに」を公開しました（非公開 → 公開） */
export function describeAudit(entry: AuditLogEntry): AuditSentence {
  const t = entry.target?.label;
  switch (entry.action) {
    case "login":
      return plain("ログインしました");
    case "login_denied":
      return plain(`ログインを拒否しました（${DENIED_LABELS[entry.detail.reason]}）`);
    case "logout":
      return plain("ログアウトしました");
    case "logout_others":
      return plain(`ほかの端末からログアウトしました（${entry.detail.count}件）`);

    case "invite_create":
      return plain(`${WIKI_ROLE_LABELS[entry.detail.role]}の招待リンクを発行しました`);
    case "invite_accept":
      return plain(`招待リンクを使って${WIKI_ROLE_LABELS[entry.detail.role]}として参加しました`);
    case "invite_revoke":
      return plain(`${WIKI_ROLE_LABELS[entry.detail.role]}の招待リンクを無効にしました`);
    case "member_role_change":
      return [
        ...named(t),
        { text: ` のロールを変更しました（${WIKI_ROLE_LABELS[entry.detail.from]} → ${WIKI_ROLE_LABELS[entry.detail.to]}）` },
      ];
    case "member_remove":
      return [...named(t), { text: ` をメンバーから外しました（${WIKI_ROLE_LABELS[entry.detail.role]}）` }];
    case "member_leave":
      return plain(`この wiki から抜けました（${WIKI_ROLE_LABELS[entry.detail.role]}）`);
    case "owner_add":
      return [...named(t), { text: " をオーナーにしました" }];
    case "owner_remove":
      return [...named(t), { text: " をオーナーから外しました" }];

    case "page_publish": {
      const d = entry.detail;
      const republish = d.from.versionId !== null && d.from.visibility !== "private";
      const range = d.from.visibility === d.visibility ? VISIBILITY_LABELS[d.visibility] : `${VISIBILITY_LABELS[d.from.visibility]} → ${VISIBILITY_LABELS[d.visibility]}`;
      const below = d.descendants ? `、配下の ${d.descendants} ページも同じ公開範囲に` : "";
      const how = d.auto ? "自動で" : "";
      return [...quoted(t), { text: `を${how}${republish ? "公開し直しました" : "公開しました"}（${range}${below}）` }];
    }
    case "page_unpublish": {
      const below = entry.detail.descendants ? `、配下の ${entry.detail.descendants} ページも` : "";
      return [...quoted(t), { text: `を非公開にしました（${VISIBILITY_LABELS[entry.detail.from]} → 非公開${below}）` }];
    }
    case "page_visibility_change": {
      const d = entry.detail;
      const below = d.descendants ? `、配下の ${d.descendants} ページも` : "";
      return [...quoted(t), { text: `の公開範囲を変更しました（${VISIBILITY_LABELS[d.from]} → ${VISIBILITY_LABELS[d.to]}${below}）` }];
    }
    case "page_auto_publish_change":
      return [...quoted(t), { text: entry.detail.enabled ? "の「新しい編集を自動で公開」をオンにしました" : "の「新しい編集を自動で公開」をオフにしました" }];
    case "unlisted_key_rotate":
      return [...quoted(t), { text: "の限定公開 URL を再発行しました" }];
    case "schedule_create":
      return [...quoted(t), { text: `の${scheduleKind(entry.detail)}を作成しました（${formatAuditTime(entry.detail.runAt)}）` }];
    case "schedule_update":
      return [
        ...quoted(t),
        { text: `の${scheduleKind(entry.detail)}の日時を変更しました（${formatAuditTime(entry.detail.from)} → ${formatAuditTime(entry.detail.runAt)}）` },
      ];
    case "schedule_cancel":
      return [...quoted(t), { text: `の${scheduleKind(entry.detail)}を取り消しました（${formatAuditTime(entry.detail.runAt)}）` }];
    case "schedule_run":
      return [...quoted(t), { text: `の${scheduleKind(entry.detail)}を実行しました${scheduledByText(entry.detail.scheduledBy)}` }];
    case "schedule_fail":
      return [...quoted(t), { text: `の${scheduleKind(entry.detail)}の実行に失敗しました${scheduledByText(entry.detail.scheduledBy)}` }];

    case "page_delete":
      return [...quoted(t), { text: `をゴミ箱に入れました${withDescendants(entry.detail.descendants)}` }];
    case "page_restore":
      return [...quoted(t), { text: `をゴミ箱から元に戻しました${withDescendants(entry.detail.descendants)}` }];
    case "page_purge":
      return [...quoted(t), { text: `をゴミ箱から完全に削除しました${withDescendants(entry.detail.descendants)}` }];

    case "page_tag_add":
      return [...quoted(t), { text: `にタグ「${entry.detail.tagName}」を付けました` }];
    case "page_tag_remove":
      return [...quoted(t), { text: `からタグ「${entry.detail.tagName}」を外しました` }];
    case "page_audio_upload":
      return [...quoted(t), { text: `に音声「${entry.detail.name}」を添付しました` }];
    case "page_audio_delete":
      return [...quoted(t), { text: `から音声「${entry.detail.name}」を削除しました` }];
    case "voice_transcribe":
      return plain("音声入力で書き起こしました");

    case "wiki_update": {
      const parts: string[] = [];
      if (entry.detail.name) parts.push(`名前を変更しました（${entry.detail.name.from} → ${entry.detail.name.to}）`);
      if (entry.detail.iconUrl) parts.push("画像を変更しました");
      return [{ text: "wiki の" }, { text: parts.join("。") || "設定を変更しました" }];
    }
    case "wiki_site_visibility":
      return [{ text: "wiki " }, ...quoted(t), { text: `の公開サイトを${entry.detail.sitePublic ? "公開" : "非公開"}にしました（${entry.detail.key}）` }];
    case "wiki_home_update":
      return plain("公開サイトのトップページの自由記述を変更しました");
    case "sns_connect":
      return plain(`${SNS_PROVIDER_LABELS[entry.detail.provider]} のアカウント（@${entry.detail.username}）を連携しました`);
    case "sns_disconnect":
      return plain(`${SNS_PROVIDER_LABELS[entry.detail.provider]} のアカウント（@${entry.detail.username}）の連携を解除しました`);
    case "sns_test_post":
      return plain(`${SNS_PROVIDER_LABELS[entry.detail.provider]} のアカウント（@${entry.detail.username}）にテスト投稿をしました`);

    case "workflow_run_fail": {
      const kind = entry.detail.actionType === "call_routine" ? "Routine を呼ぶ" : entry.detail.actionType === "remove_tag" ? "タグを外す" : entry.detail.actionType === "add_tag" ? "タグを付ける" : entry.detail.actionType;
      return [...quoted(t), { text: `のワークフローの実行に失敗しました（${kind}：${entry.detail.error}）` }];
    }

    case "tag_create":
      return [{ text: "タグ " }, ...quoted(t), { text: " を作成しました" }];
    case "tag_rename":
      return [{ text: "タグの名前を変更しました（" }, ...named(entry.detail.from), { text: ` → ${entry.detail.to}）` }];
    case "tag_delete":
      return [
        { text: "タグ " },
        ...quoted(t),
        {
          text: ` を削除しました${entry.detail.pages ? `（${entry.detail.pages} ページから外れました）` : ""}${entry.detail.blocks ? `（ワークフローのブロック ${entry.detail.blocks} 件も削除しました）` : ""}`,
        },
      ];

    case "workflow_create":
      return [{ text: "ワークフロー " }, ...quoted(t), { text: " を作成しました" }];
    case "workflow_rename":
      return [{ text: "ワークフローの名前を変更しました（" }, ...named(entry.detail.from), { text: ` → ${entry.detail.to}）` }];
    case "workflow_delete":
      return [{ text: "ワークフロー " }, ...quoted(t), { text: ` を削除しました（ブロック ${entry.detail.blocks} 件と、実行の履歴 ${entry.detail.runs} 件も削除）` }];
    case "workflow_block_create":
      return [{ text: "ワークフローのブロック " }, ...quoted(t), { text: ` を作成しました（アクション ${entry.detail.actions} 件）` }];
    case "workflow_block_update":
      return [{ text: "ワークフローのブロック " }, ...quoted(t), { text: ` を変更しました（アクション ${entry.detail.actions} 件）` }];
    case "workflow_block_delete":
      return [{ text: "ワークフローのブロック " }, ...quoted(t), { text: ` を削除しました${entry.detail.reason === "tag_deleted" ? "（トリガーのタグを削除したため）" : ""}` }];

    case "routine_create":
      return [{ text: "Routine " }, ...quoted(t), { text: " を登録しました" }];
    case "routine_update": {
      const d = entry.detail;
      const parts: string[] = [];
      if (d.name) parts.push(`名前を変更しました（${d.name.from} → ${d.name.to}）`);
      if (d.url) parts.push("URL を変更しました");
      if (d.token) parts.push("トークンを入れ替えました");
      return [{ text: "Routine " }, ...quoted(t), { text: ` を変更しました${parts.length ? `（${parts.join("、")}）` : ""}` }];
    }
    case "routine_delete":
      return [{ text: "Routine " }, ...quoted(t), { text: " を削除しました" }];
    case "routine_test":
      return [
        { text: "Routine " },
        ...quoted(t),
        { text: entry.detail.ok ? " をテスト実行しました（成功）" : ` をテスト実行しました（失敗：${ROUTINE_FAILURE_MESSAGES[entry.detail.reason]}）` },
      ];

    case "wiki_create":
      return [{ text: "wiki " }, ...quoted(t), { text: `を作成しました（${entry.detail.key}）` }];
    case "wiki_archive":
      return [{ text: "wiki " }, ...quoted(t), { text: `をアーカイブしました（${entry.detail.key}）` }];
    case "wiki_unarchive":
      return [{ text: "wiki " }, ...quoted(t), { text: `をアーカイブから戻しました（${entry.detail.key}）` }];
  }
}

function scheduledByText(by: AuditScheduledBy): string {
  return by ? `（予約した人：${by.label}）` : "";
}

function withDescendants(count: number | undefined): string {
  return count ? `（配下の ${count} ページも）` : "";
}

/** 文をつなげた文字列（テストや、リンクにしない所で使う）。 */
export function auditSentenceText(entry: AuditLogEntry): string {
  return describeAudit(entry)
    .map((p) => p.text)
    .join("");
}
