import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// wiki：ページ・ツリー（1本）・ルール・予約のまとまり
// ---------------------------------------------------------------------------

export const wikis = pgTable("wikis", {
  id: text("id").primaryKey(),
  /** 公開サイトのサブドメイン。作成後は変えない。アーカイブ中もほかの wiki では使えない */
  key: text("key").notNull().unique(),
  /** 表示名（公開サイトの名前） */
  name: text("name").notNull(),
  /** 管理画面で wiki を見分けるための画像の URL（http(s)）。null なら表示名の頭文字を出す */
  iconUrl: text("icon_url"),
  /**
   * 公開サイトの見た目（アクセント色・ロゴ・ファビコン。`WikiTheme`）。null なら既定。
   * 読むときは resolveTheme を通し、欠けた・正しくない項目は既定に戻す
   */
  theme: jsonb("theme"),
  /** nullなら使用中 */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  /** 作った人のメールアドレス。移行で作った最初の wiki は null */
  createdBy: text("created_by"),
});

const wikiId = () =>
  text("wiki_id")
    .notNull()
    .references(() => wikis.id);

// ---------------------------------------------------------------------------
// 4.1 コンテンツ
// ---------------------------------------------------------------------------

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    wikiId: wikiId(),
    /** head版タイトルのキャッシュ */
    title: text("title").notNull(),
    headVersionId: uuid("head_version_id").notNull(),
    /** nullなら未公開 */
    publishedVersionId: uuid("published_version_id"),
    visibility: text("visibility", { enum: ["public", "unlisted", "private"] }).notNull().default("private"),
    /** unlisted時のみ。推測不能なランダム値（128bit以上） */
    unlistedKey: text("unlisted_key").unique(),
    origin: text("origin", { enum: ["human", "ai_draft"] }).notNull().default("human"),
    /** 内部管理用（公開側には出さない） */
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    /** 記事の公開日（表示・RSS・並び順） */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    /** 12.3 収益化の受け口。例: { "affiliate": true } */
    monetization: jsonb("monetization"),
    /** 公開までの進み具合。approved は人が付ける */
    workflowState: text("workflow_state", { enum: ["idea", "draft", "approved"] }).notNull().default("draft"),
    /** 承認した版（承認後の編集は含めない）。approved のときだけ入る */
    approvedVersionId: uuid("approved_version_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** 見直しキューに入った日時。nullなら入っていない */
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    /** 最後に「見直し済み」にした日時 */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("pages_visibility_check", sql`${t.visibility} in ('public', 'unlisted', 'private')`),
    check("pages_origin_check", sql`${t.origin} in ('human', 'ai_draft')`),
    check("pages_workflow_state_check", sql`${t.workflowState} in ('idea', 'draft', 'approved')`),
    check("pages_approved_version_check", sql`(${t.workflowState} = 'approved') = (${t.approvedVersionId} is not null)`),
    index("pages_wiki_updated_at_idx").on(t.wikiId, t.updatedAt),
  ],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 派生元（差分・楽観ロック） */
    baseVersionId: uuid("base_version_id"),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    /** AIへ渡す要約 */
    summary: text("summary"),
    authorType: text("author_type", { enum: ["human", "ai"] }).notNull(),
    sourceProposalId: uuid("source_proposal_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("page_versions_author_type_check", sql`${t.authorType} in ('human', 'ai')`),
    index("page_versions_page_id_idx").on(t.pageId, t.createdAt),
  ],
);

/**
 * 編集中の下書き（自動保存）。版にはせず、人ごとに1つだけ持つ。「版として残す」で版を作ったら消す。
 * base_version_id は下書きを始めたときの head。head が先に進んでいたら、下書きは古い版をもとにしている。
 */
export const pageDrafts = pgTable(
  "page_drafts",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 書いている人。下書きは人ごとに持つ */
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    baseVersionId: uuid("base_version_id").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] })],
);

export const pageLinks = pgTable(
  "page_links",
  {
    fromPageId: text("from_page_id")
      .notNull()
      .references(() => pages.id),
    toPageId: text("to_page_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromPageId, t.toPageId] }), index("page_links_to_idx").on(t.toPageId)],
);

/** 新しいページのひな形。ツリーにも公開サイトにも出さない。変数（`{date}` など）はページを作るときに置き換える */
export const pageTemplates = pgTable(
  "page_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 作った人のメールアドレス */
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("page_templates_wiki_idx").on(t.wikiId, t.updatedAt)],
);

/** スター（よく開くページの目印）。ユーザーごとに持ち、別のブラウザや端末でも同じものが出る。どの wiki のものかは、ページで決まる。 */
export const pageStars = pgTable(
  "page_stars",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** 並び順（小さいほうが上）。付けたものは末尾に足す */
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

// ---------------------------------------------------------------------------
// 4.2 ツリーと構造の履歴
// 運用するのは、wiki ごとに primary ツリー1本と main だけ。複数ツリー・ブランチ前提のテーブル形は変えずに残している。
// ---------------------------------------------------------------------------

/** 存在宣言のみ。どのコミットにツリーが含まれるかは commit_trees で決まる。 */
export const trees = pgTable("trees", {
  id: text("id").primaryKey(),
  wikiId: wikiId(),
  /** URLに使用（'by-project' 'by-theme'）。wiki の中で重ならない */
  key: text("key").notNull(),
  /** 以前は画面から変えられた表示名。いまはどこにも出していない（公開サイト・管理画面は固定の文言を使う） */
  name: text("name").notNull(),
  /** パンくず・既定ナビ用（1つだけ） */
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [
  unique("trees_wiki_key_unique").on(t.wikiId, t.key),
  // primary は wiki ごとに1つだけ
  uniqueIndex("trees_one_primary_idx").on(t.wikiId).where(sql`${t.isPrimary}`),
]);

/** 1ツリーの状態（イミュータブル） */
export const treeSnapshots = pgTable("tree_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  treeId: text("tree_id")
    .notNull()
    .references(() => trees.id),
  createdAt: createdAt(),
});

export const treeNodes = pgTable(
  "tree_nodes",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => treeSnapshots.id),
    /** ノードはすべてページ。node_id = page_id */
    nodeId: text("node_id").notNull(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    /** nullなら最上位 */
    parentNodeId: text("parent_node_id"),
    /** fractional index */
    position: text("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.nodeId] }),
    unique("tree_nodes_snapshot_page_unique").on(t.snapshotId, t.pageId),
    check("tree_nodes_page_check", sql`${t.nodeId} = ${t.pageId}`),
    index("tree_nodes_page_id_idx").on(t.pageId),
  ],
);

/** コミット：全ツリーの状態をまとめて記録 */
export const structureCommits = pgTable("structure_commits", {
  id: uuid("id").primaryKey().defaultRandom(),
  wikiId: wikiId(),
  message: text("message"),
  authorType: text("author_type", { enum: ["human", "ai"] }).notNull().default("human"),
  sourceProposalId: uuid("source_proposal_id"),
  createdAt: createdAt(),
});

/** 親2つ = マージコミット */
export const structureCommitParents = pgTable(
  "structure_commit_parents",
  {
    commitId: uuid("commit_id")
      .notNull()
      .references(() => structureCommits.id),
    parentCommitId: uuid("parent_commit_id").notNull(),
    /** 0 = 第1親（ブランチの直前のhead）。マージ時は1がマージ元。 */
    ordinal: integer("ordinal").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.commitId, t.parentCommitId] }),
    // 自動生成名はPostgresの識別子上限（63文字）を超えるので明示する
    foreignKey({ name: "structure_commit_parents_parent_fk", columns: [t.parentCommitId], foreignColumns: [structureCommits.id] }),
  ],
);

export const commitTrees = pgTable(
  "commit_trees",
  {
    commitId: uuid("commit_id")
      .notNull()
      .references(() => structureCommits.id),
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id),
    /** 変更のないツリーは親と同じsnapshotを指す */
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => treeSnapshots.id),
  },
  (t) => [primaryKey({ columns: [t.commitId, t.treeId] })],
);

/** ブランチ（名前付きポインタ）。wiki ごとに main のみ運用。 */
export const structureBranches = pgTable(
  "structure_branches",
  {
    wikiId: wikiId(),
    name: text("name").notNull(),
    headCommitId: uuid("head_commit_id")
      .notNull()
      .references(() => structureCommits.id),
    kind: text("kind", { enum: ["main", "manual", "ai_proposal"] }).notNull(),
    createdAt: createdAt(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.wikiId, t.name] }),
    check("structure_branches_kind_check", sql`${t.kind} in ('main', 'manual', 'ai_proposal')`),
  ],
);

// ---------------------------------------------------------------------------
// ルール（トリガー → アクション）と実行ログ
// ---------------------------------------------------------------------------

/**
 * ルールの設定。定型ルール（shared の RULE_PRESETS）は id が定型ルールの id と同じで、
 * 設定を保存するまでは行が無い（無効として扱う）。wiki ごとに持つ。
 */
export const rules = pgTable(
  "rules",
  {
    wikiId: wikiId(),
    id: text("id").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** RuleTrigger */
    trigger: jsonb("trigger").notNull(),
    /** RuleAction[] */
    actions: jsonb("actions").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wikiId, t.id] })],
);

/** ルールが何かをした（または失敗した）記録。何も起きなかった回は残さない。 */
export const ruleRuns = pgTable(
  "rule_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    ruleId: text("rule_id").notNull(),
    status: text("status", { enum: ["done", "failed"] }).notNull(),
    summary: text("summary").notNull(),
    /** 対象になったページ */
    pageIds: jsonb("page_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    check("rule_runs_status_check", sql`${t.status} in ('done', 'failed')`),
    foreignKey({ name: "rule_runs_rule_fk", columns: [t.wikiId, t.ruleId], foreignColumns: [rules.wikiId, rules.id] }),
    index("rule_runs_rule_idx").on(t.wikiId, t.ruleId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// 4.6 予約公開 ／ 7 公開パイプライン
// ---------------------------------------------------------------------------

export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    actionType: text("action_type", { enum: ["publish_page", "unpublish_page", "merge_branch"] }).notNull(),
    /** publish / unpublish */
    pageId: text("page_id").references(() => pages.id),
    /** publish時に固定する版（予約後の編集は含めない） */
    versionId: uuid("version_id").references(() => pageVersions.id),
    /** publish時の公開範囲（通常 'public'） */
    targetVisibility: text("target_visibility", { enum: ["public", "unlisted"] }),
    /** merge_branch（フェーズ3） */
    branchName: text("branch_name"),
    /** 同時公開グループ（シリーズ記事など）。同じ batch_id は1トランザクションで実行する */
    batchId: uuid("batch_id"),
    /** ルールが入れた予約なら、その実行ログ */
    ruleRunId: uuid("rule_run_id").references(() => ruleRuns.id),
    /** UTC保存。入出力はJST */
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["scheduled", "running", "done", "failed", "canceled"] })
      .notNull()
      .default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "scheduled_actions_action_type_check",
      sql`${t.actionType} in ('publish_page', 'unpublish_page', 'merge_branch')`,
    ),
    check(
      "scheduled_actions_status_check",
      sql`${t.status} in ('scheduled', 'running', 'done', 'failed', 'canceled')`,
    ),
    index("scheduled_actions_due_idx").on(t.runAt).where(sql`${t.status} = 'scheduled'`),
    index("scheduled_actions_page_idx").on(t.pageId),
  ],
);

/** 公開状態に影響する操作の記録。ワーカーがデバウンスしてビルドを起動する。 */
export const publishEvents = pgTable("publish_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  wikiId: wikiId(),
  kind: text("kind").notNull(),
  pageId: text("page_id"),
  scheduledActionId: uuid("scheduled_action_id"),
  createdAt: createdAt(),
});

/** 起動したビルド。last_event_id までの publish_events を反映済み。 */
export const siteBuilds = pgTable("site_builds", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
  contentHash: text("content_hash").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// ユーザー・wiki のメンバー・招待（管理画面に入れる人）
// ---------------------------------------------------------------------------

/**
 * 管理画面に入れる人。Google のアカウント ID（sub）で見分ける。
 * 行を消さない（外した人が書いた版や履歴を残すため）。
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Google のアカウント ID。ADMIN_EMAILS からの移行と締め出し用のスクリプトで作った行は、最初のログインまで空 */
    googleSub: text("google_sub").unique(),
    /** 表示用。ログインのたびに Google から受け取ったもので更新する（小文字） */
    email: text("email").notNull(),
    name: text("name"),
    /** すべての wiki に管理者として入れ、wiki の作成・アーカイブとオーナーの追加・解除ができる */
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [index("users_email_idx").on(t.email)],
);

/** wiki ごとのメンバー。オーナーは行が無くても、すべての wiki に管理者として入れる。 */
export const wikiMembers = pgTable(
  "wiki_members",
  {
    wikiId: wikiId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["admin", "editor"] }).notNull(),
    createdAt: createdAt(),
    /** 参加に使った招待。招待を通さずに入った人（wiki を作ったオーナー・移行）は null */
    inviteId: uuid("invite_id").references((): AnyPgColumn => invites.id),
  },
  (t) => [
    primaryKey({ columns: [t.wikiId, t.userId] }),
    check("wiki_members_role_check", sql`${t.role} in ('admin', 'editor')`),
    index("wiki_members_user_idx").on(t.userId),
  ],
);

/** 招待リンク。1リンクで1人、期限つき。値そのものは持たず、ハッシュだけを持つ。 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiId: wikiId(),
    role: text("role", { enum: ["admin", "editor"] }).notNull(),
    /** リンクの値（128bit の乱数）の SHA-256（16進） */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedBy: uuid("used_by").references(() => users.id),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check("invites_role_check", sql`${t.role} in ('admin', 'editor')`),
    index("invites_wiki_idx").on(t.wikiId),
  ],
);
