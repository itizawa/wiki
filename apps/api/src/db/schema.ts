import { sql } from "drizzle-orm";
import {
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
// 4.1 コンテンツ
// ---------------------------------------------------------------------------

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
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
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("pages_visibility_check", sql`${t.visibility} in ('public', 'unlisted', 'private')`),
    check("pages_origin_check", sql`${t.origin} in ('human', 'ai_draft')`),
    index("pages_updated_at_idx").on(t.updatedAt),
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

export const slugHistory = pgTable(
  "slug_history",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    slug: text("slug").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.slug] })],
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

// ---------------------------------------------------------------------------
// 4.2 ツリーと構造の履歴
// 運用するのは primary ツリー1本と main だけ。複数ツリー・ブランチ前提のテーブル形は変えずに残している。
// ---------------------------------------------------------------------------

/** 存在宣言のみ。どのコミットにツリーが含まれるかは commit_trees で決まる。 */
export const trees = pgTable("trees", {
  id: text("id").primaryKey(),
  /** URLに使用（'by-project' 'by-theme'） */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  isPublic: boolean("is_public").notNull().default(true),
  /** パンくず・既定ナビ用（1つだけ） */
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [
  // primary は1つだけ
  uniqueIndex("trees_one_primary_idx").on(t.isPrimary).where(sql`${t.isPrimary}`),
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
    /** ツリー内で安定。page種別は node_id = page_id */
    nodeId: text("node_id").notNull(),
    kind: text("kind", { enum: ["page", "folder"] }).notNull(),
    pageId: text("page_id").references(() => pages.id),
    /** folder用 */
    title: text("title"),
    /** nullなら最上位 */
    parentNodeId: text("parent_node_id"),
    /** fractional index */
    position: text("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.nodeId] }),
    unique("tree_nodes_snapshot_page_unique").on(t.snapshotId, t.pageId),
    check("tree_nodes_kind_check", sql`${t.kind} in ('page', 'folder')`),
    check(
      "tree_nodes_shape_check",
      sql`(${t.kind} = 'page' and ${t.pageId} is not null and ${t.nodeId} = ${t.pageId}) or (${t.kind} = 'folder' and ${t.pageId} is null and ${t.title} is not null)`,
    ),
    index("tree_nodes_page_id_idx").on(t.pageId),
  ],
);

/** コミット：全ツリーの状態をまとめて記録 */
export const structureCommits = pgTable("structure_commits", {
  id: uuid("id").primaryKey().defaultRandom(),
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

/** ブランチ（名前付きポインタ）。フェーズ1は main のみ運用。 */
export const structureBranches = pgTable(
  "structure_branches",
  {
    name: text("name").primaryKey(),
    headCommitId: uuid("head_commit_id")
      .notNull()
      .references(() => structureCommits.id),
    kind: text("kind", { enum: ["main", "manual", "ai_proposal"] }).notNull(),
    createdAt: createdAt(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
  },
  (t) => [check("structure_branches_kind_check", sql`${t.kind} in ('main', 'manual', 'ai_proposal')`)],
);

// ---------------------------------------------------------------------------
// 4.6 予約公開 ／ 7 公開パイプライン
// ---------------------------------------------------------------------------

export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
