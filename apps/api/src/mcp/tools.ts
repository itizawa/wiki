import {
  bodyLines,
  COVER_UPLOAD_TYPES,
  createEditRequestInput,
  createTagInput,
  createWikiInput,
  createPageInput,
  EDIT_REQUEST_ITEM_KINDS,
  EDIT_REQUEST_LIMITS,
  editRequestCommentInput,
  IMAGE_MAX_BYTES,
  newImageName,
  pageCoverSchema,
  publishVisibilitySchema,
  renameTagInput,
  ROUTINE_INSTRUCTION_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  resolveHome,
  savePageInput,
  sniffImageType,
  updateHomeInput,
  WORKFLOW_ACTIONS_MAX,
  workflowBlockInput,
  workflowInput,
  WORKFLOWS_MAX,
  wikiOrigin,
  type WorkflowBlock,
  type WorkflowBlockInput,
  type EditRequest,
  type OAuthScope,
} from "@wiki/shared";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { editRequestItems, editRequests, pages, pageTags, pageVersions, scheduledActions, users, wikiTags } from "../db/schema";
import { isAssignable } from "../tasks/service";
import {
  acceptEditRequestItems,
  addEditRequestComment,
  createEditRequest,
  listEditRequests,
  rejectEditRequestItem,
  resolveEditRequestItem,
  withdrawEditRequest,
} from "../editRequests/service";
import { HttpError, notFound } from "../errors";
import type { ImageStore } from "../images/store";
import type { AgentContext } from "../oauth/service";
import { createPage, deletePage, findLivePage, listTrash, lockTrashGroup, restorePage, savePage, setPageCover } from "../routes/pages";
import { cancelSchedule, createSchedule, listActions, publishAudited, unpublishAudited } from "../routes/publishing";
import { agentActor } from "../audit/service";
import { listPageAudio } from "../audio/service";
import { signAudioUrl } from "../audio/sign";
import { descendantIds, loadTreeIndex } from "../publishing/hierarchy";
import { changeStructure, getPrimaryTree, loadStructure } from "../structure/repo";
import { createTag, deleteTag, detachTag, listTags, pageTagList, renameTag, tagsForPages } from "../tags/service";
import { createBlock, deleteBlock, listBlocks, listRoutineChoices, replaceBlock } from "../workflows/blocks";
import { createWorkflow, deleteWorkflow, findWorkflow, listWorkflows, renameWorkflow } from "../workflows/workflows";
import { attachTagAndEnqueue } from "../workflows/enqueue";
import { runAfterResponse, type RunDeps } from "../workflows/run";
import { roleIn, rolesByWiki } from "../users/service";
import { createWiki, findOpenWiki, listWikis, updateHome } from "../wikis/service";

/**
 * MCP の道具。どれも Cookie の API と同じ処理（楽観ロック・構造のコミット・公開の記録）を通る。
 * 公開・予約は wiki.publish、削除（ゴミ箱に入れる・一覧・元に戻す）は wiki.delete を許したアプリだけが使える。
 * ゴミ箱から完全に削除する道具は置かない（完全に消せるのは、管理画面の人だけ）。
 * 編集リクエストを出す・読む・返信する・取り下げるのは wiki.suggest、採用・却下は本文が変わるので wiki.write（指摘を解決済みにするのも、人の代わりに片付ける操作なので wiki.write）。
 */
type ToolContext = {
  db: Db;
  config: AppConfig;
  agent: AgentContext;
  /** アップロードした画像の置き場所（カバー画像を送ってもらうときに使う）。無ければ画像は受け取らない */
  images?: ImageStore | null;
  /** タグを付けて積んだワークフローの実行を、応答のあとに動かすためのもの */
  routineFetch?: RunDeps["routineFetch"];
  defer?: ((promise: Promise<unknown>) => void) | null;
};

type Tool<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  scope: OAuthScope;
  input: S;
  /** tools/list に出す JSON Schema */
  inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, input: z.output<S>): Promise<unknown>;
};

const tool = <S extends z.ZodTypeAny>(t: Tool<S>) => t;

const wikiKey = z.string().min(1).max(64);
const pageId = z.string().min(1).max(64);
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const WIKI_PROP = { wiki: str("wiki の key（list_wikis で分かる）") };

/** その許可で作ったページ。1つのテーブルからの問い合わせでは列名にテーブル名が付かないので、相関する列は名前で書く */
const createdBy = (agent: AgentContext) =>
  sql`exists (select 1 from "page_versions" v where v."page_id" = "pages"."id" and v."base_version_id" is null and v."oauth_grant_id" = ${agent.grantId})`;

/** wiki.private が無い許可で読めるページ：公開中のものと、その許可で作ったもの */
function visibleTo(agent: AgentContext): SQL | undefined {
  if (agent.scopes.includes("wiki.private")) return undefined;
  return or(and(eq(pages.visibility, "public"), isNotNull(pages.publishedVersionId)), createdBy(agent));
}

/**
 * 読める版。wiki.private が無いと、公開中のページは公開した版までで、公開前の書きかけは見せない。
 * ただし、その許可で作ったページと、最新の版をその許可で書いたページは最新の版。
 */
function readableVersionId(agent: AgentContext): SQL {
  if (agent.scopes.includes("wiki.private")) return sql`"pages"."head_version_id"`;
  return sql`case when ${createdBy(agent)}
    or exists (select 1 from "page_versions" hv where hv."id" = "pages"."head_version_id" and hv."oauth_grant_id" = ${agent.grantId})
    then "pages"."head_version_id" else "pages"."published_version_id" end`;
}

async function readableVersion(db: Db, agent: AgentContext, id: string): Promise<string> {
  const [row] = await db.select({ versionId: sql<string>`${readableVersionId(agent)}` }).from(pages).where(eq(pages.id, id));
  return row!.versionId;
}

/** 指定の版を公開・予約してよいか。wiki.private が無いと、読める版しか扱えない（見ていない書きかけを公開させない） */
async function usableVersion(db: Db, agent: AgentContext, id: string, versionId: string | undefined): Promise<string> {
  const readable = await readableVersion(db, agent, id);
  if (versionId === undefined || versionId === readable || agent.scopes.includes("wiki.private")) return versionId ?? readable;
  throw new HttpError(403, "insufficient_scope", "this version is not readable without wiki.private");
}

/**
 * 配下のページも一緒に変わる操作の前に。wiki.private が無いと、配下に読めないページがあれば止める
 * （中身は漏れなくても、非公開・限定公開のページの置き場所や公開範囲を変えてしまうので）
 */
async function assertSubtreeVisible(db: Db, agent: AgentContext, wikiId: string, id: string): Promise<void> {
  const cond = visibleTo(agent);
  if (!cond) return;
  const ids = descendantIds(await loadTreeIndex(db, wikiId), id);
  if (ids.length === 0) return;
  const seen = await db.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, ids), isNull(pages.deletedAt), cond));
  const live = await db.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, ids), isNull(pages.deletedAt)));
  if (seen.length < live.length) {
    throw new HttpError(403, "insufficient_scope", "pages under this page are not visible to this connection (needs wiki.private)");
  }
}

async function canSee(db: Db, agent: AgentContext, id: string): Promise<boolean> {
  const cond = visibleTo(agent);
  if (!cond) return true;
  const [row] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.id, id), cond));
  return Boolean(row);
}

/** 読めないページは、無いものとして扱う */
/** 許可した人がメンバーの、使用中の wiki。メンバーでない wiki は無いものとして扱う */
async function memberWiki(db: Db, agent: AgentContext, key: string) {
  const wiki = await findOpenWiki(db, key);
  if (!(await roleIn(db, agent.user, wiki.id))) throw new HttpError(404, "wiki_not_found", `wiki ${key} not found`);
  return wiki;
}

/** その wiki のタグを名前で探す。無い名前は断る（MCP からタグは作らない） */
async function findTagByName(db: Db, wikiId: string, name: string) {
  const [tag] = await db
    .select({ id: wikiTags.id })
    .from(wikiTags)
    .where(and(eq(wikiTags.wikiId, wikiId), eq(wikiTags.name, name.trim())));
  if (!tag) throw notFound(`tag ${name} (list_tags で名前を確かめる。タグは管理画面で作る)`);
  return tag;
}

// ---------------------------------------------------------------------------
// wiki の設定（wiki.admin）
// ---------------------------------------------------------------------------

/** 許可した人がその wiki の管理者（かオーナー）であること。メンバーでなければ無いものとして扱う */
async function adminWiki(db: Db, agent: AgentContext, key: string) {
  const wiki = await memberWiki(db, agent, key);
  if ((await roleIn(db, agent.user, wiki.id)) !== "admin") throw new HttpError(403, "admin_only", "only admins of this wiki can do this");
  return wiki;
}

const tagName = z.string().min(1).max(100);
/** MCP で渡すブロック：タグと Routine を、ID の代わりに名前で指す */
const namedBlockInput = z.object({
  trigger: z.discriminatedUnion("type", [
    z.object({ type: z.literal("tag_attached"), tag: tagName }),
    z.object({ type: z.literal("page_first_published") }),
    // 時刻と曜日の検査は workflowBlockInput に任せる（管理画面と同じ文言で断る）
    z.object({ type: z.literal("schedule"), pageId: z.string().min(1), time: z.string(), weekdays: z.array(z.number()) }),
  ]),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("call_routine"), routine: z.string().min(1).max(200), instruction: z.string() }),
        z.object({ type: z.literal("remove_tag"), tag: tagName }),
        z.object({ type: z.literal("add_tag"), tag: tagName }),
        // 題・説明の長さの検査は workflowBlockInput に任せる。担当者はメールアドレスで指す（省けば担当者なし）
        z.object({ type: z.literal("create_task"), title: z.string(), description: z.string().optional(), assignee: z.string().max(320).nullable().optional() }),
      ]),
    )
    .min(1)
    .max(WORKFLOW_ACTIONS_MAX),
});
type NamedBlockInput = z.output<typeof namedBlockInput>;

const BLOCK_DESCRIPTION =
  "ブロックは、トリガー1つと、上から順に行うアクションの並び（1〜" + WORKFLOW_ACTIONS_MAX + "件）。" +
  "トリガーは tag_attached（tag のタグが付いたとき）・page_first_published（ページが初めて公開されたとき）・" +
  "schedule（weekdays の曜日の time（JST）になったら、pageId のページを対象に動く。Cron は5分おきなので数分遅れることがある）。" +
  "アクションは call_routine（routine の Routine を呼び、instruction を依頼として渡す。Routine が始まった時点で成功になり、終わるのを待たない）・remove_tag・add_tag（付けたタグのブロックも動く）・" +
  "create_task（人の作業。title・description のタスクを作り、管理画面の「タスク」で人が完了にするまで、実行を止める。assignee は担当者のメールアドレスで、省くと担当者なし）。" +
  "タグは list_tags、Routine は list_routines にある名前で指す。";
const BLOCK_PROPS = {
  trigger: {
    type: "object",
    description:
      '{ "type": "tag_attached", "tag": "タグの名前" } / { "type": "page_first_published" } / { "type": "schedule", "pageId": "対象のページの ID", "time": "07:00", "weekdays": [0, 1, 2, 3, 4, 5, 6] }',
    properties: {
      type: { type: "string", enum: ["tag_attached", "page_first_published", "schedule"] },
      tag: str("タグの名前（tag_attached のとき）"),
      pageId: str("対象のページの ID（schedule のとき）"),
      time: str("起動する時刻。HH:MM、24時間、JST（schedule のとき）"),
      weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "起動する曜日。0 が日曜、毎日なら 0〜6 のすべて（schedule のとき）" },
    },
    required: ["type"],
  },
  actions: {
    type: "array",
    minItems: 1,
    maxItems: WORKFLOW_ACTIONS_MAX,
    description:
      '上から順に行う。{ "type": "call_routine", "routine": "Routine の名前", "instruction": "Routine への依頼" } / { "type": "remove_tag", "tag": "…" } / { "type": "add_tag", "tag": "…" } / { "type": "create_task", "title": "タスクの題", "description": "説明", "assignee": "担当者のメールアドレス（省くと担当者なし）" }',
    items: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["call_routine", "remove_tag", "add_tag", "create_task"] },
        routine: str("Routine の名前（call_routine のとき）"),
        instruction: str(`Routine への依頼（call_routine のとき。${ROUTINE_INSTRUCTION_MAX}文字まで）`),
        tag: str("タグの名前（remove_tag / add_tag のとき）"),
        title: str(`タスクの題（create_task のとき。${TASK_TITLE_MAX}文字まで）`),
        description: str(`タスクの説明（create_task のとき。${TASK_DESCRIPTION_MAX}文字まで。省いてよい）`),
        assignee: str("担当者のメールアドレス（create_task のとき。その wiki のメンバー。省くと担当者なし）"),
      },
      required: ["type"],
    },
  },
};

/** 名前で指したブロックを、ID で指す入力に直す。無いタグ・Routine は 404、依頼文の誤りは 400 */
async function resolveBlock(tx: Db, agent: AgentContext, wikiId: string, input: NamedBlockInput): Promise<WorkflowBlockInput> {
  const routines = new Map((await listRoutineChoices(tx)).map((r) => [r.name, r.id]));
  const routineId = (name: string) => {
    const id = routines.get(name.trim());
    if (!id) throw notFound(`routine ${name} (list_routines で名前を確かめる。Routine は管理画面で登録する)`);
    return id;
  };
  const trigger = input.trigger.type === "tag_attached" ? { type: "tag_attached" as const, tagId: (await findTagByName(tx, wikiId, input.trigger.tag)).id } : input.trigger;
  // 読めないページ（wiki.private が無いときの非公開のページ）は、時刻で起動する対象にもできない
  if (input.trigger.type === "schedule" && !(await canSee(tx, agent, input.trigger.pageId))) throw notFound(`page ${input.trigger.pageId}`);
  const actions = [];
  for (const a of input.actions) {
    if (a.type === "create_task") {
      actions.push({ type: a.type, title: a.title, description: a.description ?? "", assigneeId: a.assignee ? await assigneeByEmail(tx, wikiId, a.assignee) : null });
      continue;
    }
    actions.push(a.type === "call_routine" ? { type: a.type, routineId: routineId(a.routine), instruction: a.instruction } : { type: a.type, tagId: (await findTagByName(tx, wikiId, a.tag)).id });
  }
  const parsed = workflowBlockInput.safeParse({ trigger, actions });
  if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid block", parsed.error.issues);
  return parsed.data;
}

/** タスクの担当者を、メールアドレスで探す（その wiki の担当者にできる人だけ。いなければ 404） */
async function assigneeByEmail(tx: Db, wikiId: string, email: string): Promise<string> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  for (const r of rows) if (await isAssignable(tx, wikiId, r.id)) return r.id;
  throw notFound(`member ${email} (担当者は、この wiki のメンバーのメールアドレスで指す)`);
}

/** ブロックを、create_workflow_block に渡すのと同じ形（名前で指す）で返す */
const describeBlock = (b: WorkflowBlock) => ({
  id: b.id,
  trigger: b.trigger.type === "tag_attached" ? { type: b.trigger.type, tag: b.trigger.tagName } : b.trigger,
  actions: b.actions.map((a) =>
    a.type === "call_routine"
      ? { type: a.type, routine: a.routineName, instruction: a.instruction }
      : a.type === "create_task"
        ? { type: a.type, title: a.title, description: a.description, assignee: a.assigneeName }
        : { type: a.type, tag: a.tagName },
  ),
});

async function visiblePage(db: Db, agent: AgentContext, wikiId: string, id: string) {
  const page = await findLivePage(db, wikiId, id);
  if (!(await canSee(db, agent, id))) throw notFound(`page ${id}`);
  return page;
}

// ---------------------------------------------------------------------------
// 編集リクエスト
// ---------------------------------------------------------------------------

/** 最新の版を読めないアプリ（wiki.private が無く、公開前の編集がある）には、その版への提案も採用もさせない */
async function assertNoHiddenEdits(db: Db, agent: AgentContext, page: { id: string; headVersionId: string }): Promise<void> {
  if ((await readableVersion(db, agent, page.id)) !== page.headVersionId) {
    throw new HttpError(409, "hidden_edits", "this page has unpublished edits that this connection cannot read (needs wiki.private)");
  }
}

/**
 * wiki.private が無い許可で読めるリクエストは、読めるページの、その許可で出したものだけ。
 * ほかの人が出したリクエストには、そのアプリが読めない版（公開前の書きかけ）の文面が入っていることがある
 */
const ownRequestsOnly = (agent: AgentContext) => (agent.scopes.includes("wiki.private") ? undefined : agent.grantId);

/** 読めない項目（別のページのもの、読めないリクエストのもの）は、無いものとして扱う */
async function assertItemReadable(db: Db, agent: AgentContext, pageId: string, itemId: string): Promise<void> {
  const own = ownRequestsOnly(agent);
  const [row] = await db
    .select({ id: editRequestItems.id })
    .from(editRequestItems)
    .innerJoin(editRequests, eq(editRequests.id, editRequestItems.requestId))
    .where(and(eq(editRequestItems.id, itemId), eq(editRequests.pageId, pageId), own ? eq(editRequests.oauthGrantId, own) : undefined));
  if (!row) throw notFound("edit request item");
}

const describeRequest = (r: EditRequest, hideCurrent: boolean) => ({
  id: r.id,
  pageId: r.pageId,
  comment: r.comment,
  createdBy: r.createdBy.name,
  via: r.via,
  createdAt: r.createdAt,
  items: r.items.map((i) => ({
    id: i.id,
    /** suggestion: 提案（replacement を持つ） / note: 指摘（body を持つ） */
    kind: i.kind,
    status: i.status,
    baseVersionId: i.baseVersionId,
    startLine: i.startLine,
    endLine: i.endLine,
    originalText: i.originalText,
    replacement: i.replacement,
    reason: i.reason,
    body: i.body,
    stale: i.stale,
    /** 最新の版での行の範囲（未対応・却下の項目で、場所が決まるときだけ） */
    current: hideCurrent ? null : i.current,
    decidedBy: i.decidedBy?.name ?? null,
    decidedAt: i.decidedAt,
    acceptedVersionId: i.acceptedVersionId,
    /** 返信（古い順）。本文はプレーンテキスト。書いた人は、項目を出した人と同じ決まり（アプリからなら via にアプリの名前） */
    comments: i.comments.map((c) => ({ id: c.id, body: c.body, createdBy: c.createdBy.name, via: c.via, createdAt: c.createdAt })),
  })),
});

export const TOOLS = [
  tool({
    name: "list_wikis",
    description: "使用中の wiki の一覧（key と名前）を返す。",
    scope: "wiki.read",
    input: z.object({}),
    inputSchema: schema({}, []),
    async run({ db, config, agent }) {
      const roles = agent.user.isOwner ? null : await rolesByWiki(db, agent.user.id);
      const wikis = await listWikis(db, config, { includeArchived: false, roles });
      return { wikis: wikis.map((w) => ({ key: w.key, name: w.name })) };
    },
  }),
  tool({
    name: "search_pages",
    description:
      "ページをタイトルと本文から探す。query を省くと、更新の新しい順に返す。tag（タグの名前）を渡すと、そのタグが付いたページだけにする（query と両方なら、両方を満たすもの。その wiki に無いタグは 0 件）。各ページの tags はタグの名前。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey, query: z.string().max(200).optional(), tag: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(20) }),
    inputSchema: schema(
      { ...WIKI_PROP, query: str("探す語（省略可）"), tag: str("タグの名前（省略可）。渡すと、そのタグが付いたページだけにする"), limit: { type: "integer", minimum: 1, maximum: 100, description: "最大件数（既定 20）" } },
      ["wiki"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const q = input.query?.trim();
      const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
      let tagFilter: SQL | undefined;
      if (input.tag !== undefined) {
        const [tag] = await db.select({ id: wikiTags.id }).from(wikiTags).where(and(eq(wikiTags.wikiId, wiki.id), eq(wikiTags.name, input.tag.trim())));
        if (!tag) return { pages: [] };
        tagFilter = inArray(pages.id, db.select({ id: pageTags.pageId }).from(pageTags).where(eq(pageTags.tagId, tag.id)));
      }
      const rows = await db
        .select({
          id: pages.id,
          title: pageVersions.title,
          visibility: pages.visibility,
          published: isNotNull(pages.publishedVersionId).mapWith(Boolean),
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .innerJoin(pageVersions, eq(pageVersions.id, readableVersionId(agent)))
        .where(
          and(
            eq(pages.wikiId, wiki.id),
            isNull(pages.deletedAt),
            visibleTo(agent),
            like ? or(ilike(pageVersions.title, like), ilike(pageVersions.bodyMd, like)) : undefined,
            tagFilter,
          ),
        )
        .orderBy(desc(pages.updatedAt))
        .limit(input.limit);
      const tagsById = await tagsForPages(db, rows.map((r) => r.id));
      return { pages: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), tags: (tagsById.get(r.id) ?? []).map((t) => t.name) })) };
    },
  }),
  tool({
    name: "get_page",
    description:
      "ページの最新の本文（Markdown）を返す。update_page と create_edit_request には、ここで返す headVersionId を baseVersionId として渡す。" +
      "本文の行は、bodyMd を改行（\\n）で区切って1から数える（空行も1行。末尾が改行なら、最後に空の行が1つある。lineCount が行数）。" +
      "非公開のページも読む許可が無いと、公開中のページは公開した版を返し、公開前の編集があれば hasHiddenEdits が true になる（そのあいだは更新できない）。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const versionId = await readableVersion(db, agent, page.id);
      const [version] = await db.select().from(pageVersions).where(eq(pageVersions.id, versionId));
      return {
        id: page.id,
        title: version!.title,
        icon: page.icon,
        bodyMd: version!.bodyMd,
        lineCount: bodyLines(version!.bodyMd).length,
        headVersionId: versionId,
        hasHiddenEdits: versionId !== page.headVersionId,
        visibility: page.visibility,
        published: page.publishedVersionId !== null,
        updatedAt: page.updatedAt.toISOString(),
        tags: ((await tagsForPages(db, [page.id])).get(page.id) ?? []).map((t) => t.name),
      };
    },
  }),
  tool({
    name: "get_tree",
    description:
      "ページのツリーを返す（親子と並び順）。読めないページはタイトルを伏せる。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const state = await loadStructure(db, wiki.id);
      const tree = await getPrimaryTree(db, wiki.id);
      const nodes = state.trees[tree.id]?.nodes ?? [];
      const titles = new Map(
        (
          await db
            .select({ id: pages.id, title: pageVersions.title })
            .from(pages)
            .innerJoin(pageVersions, eq(pageVersions.id, readableVersionId(agent)))
            .where(and(eq(pages.wikiId, wiki.id), isNull(pages.deletedAt), visibleTo(agent)))
        ).map((p) => [p.id, p.title]),
      );
      return {
        nodes: nodes.map((n) => ({
          pageId: n.pageId,
          parentPageId: n.parentNodeId,
          position: n.position,
          title: titles.get(n.pageId) ?? null,
        })),
      };
    },
  }),
  tool({
    name: "list_page_audio",
    description:
      "ページに添付された音声（動画のナレーションなど。管理画面で人が録音・アップロードしたもの）の一覧を返す。" +
      "各音声の url は、ログインなしで取り出せる署名つきの URL（GET で音声のファイルそのものが返る）。expiresAt（発行から1時間後）を過ぎると使えないので、必要になったらもう一度この道具で取り直す。URL を他人に渡さない。" +
      "非公開のページも読む許可が無いと、読めるページ（公開中のものと、その許可で作ったもの）のものだけ。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, config, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const audio = await listPageAudio(db, page.id);
      return {
        audio: await Promise.all(
          audio.map(async (a) => ({
            id: a.id,
            name: a.name,
            contentType: a.contentType,
            bytes: a.bytes,
            durationMs: a.durationMs,
            createdAt: a.createdAt,
            ...(await signAudioUrl(config, a.id)),
          })),
        ),
      };
    },
  }),
  tool({
    name: "create_page",
    description: "ページを作る（非公開の下書きとして作られ、公開はしない）。parentPageId を省くと最上位の末尾に置く。",
    scope: "wiki.write",
    // テンプレートからの作成（templateId）は MCP では受け付けないので、タイトルは必須のまま
    input: z.object({ wiki: wikiKey }).merge(createPageInput.innerType().omit({ templateId: true }).required({ title: true })),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        title: str("タイトル", { maxLength: 200 }),
        bodyMd: str("本文（Markdown）"),
        parentPageId: str("この下に置く親ページの ID（省略可）"),
        icon: str("アイコン。絵文字1つ（省略可）"),
      },
      ["wiki", "title"],
    ),
    async run({ db, agent }, { wiki: key, ...input }) {
      const wiki = await memberWiki(db, agent, key);
      // 読めない親は、無いものとして扱う（非公開の部分木の下に、ページを足させない）
      if (input.parentPageId) await visiblePage(db, agent, wiki.id, input.parentPageId);
      const id = await db.transaction((tx) => createPage(tx, wiki.id, input, { createdBy: agent.user.id, oauthGrantId: agent.grantId }));
      const page = await findLivePage(db, wiki.id, id);
      return { id, headVersionId: page.headVersionId };
    },
  }),
  tool({
    name: "update_page",
    description:
      "ページの本文とタイトルを保存する。baseVersionId が最新の版と違えば保存せずにエラーを返すので、get_page で読み直してからやり直す。公開中のページでも、公開側は人が公開し直すまで変わらない。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, title: savePageInput.shape.title.optional() }).merge(savePageInput.omit({ title: true })),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        baseVersionId: str("get_page で返した headVersionId"),
        title: str("タイトル（省略すると変えない）", { maxLength: 200 }),
        bodyMd: str("本文（Markdown）。全体を置き換える"),
      },
      ["wiki", "pageId", "baseVersionId", "bodyMd"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      await db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, input.pageId);
        if ((await readableVersion(tx, agent, page.id)) !== page.headVersionId) {
          throw new HttpError(409, "hidden_edits", "this page has unpublished edits that this connection cannot read (needs wiki.private)");
        }
        await savePage(
          tx,
          wiki.id,
          page.id,
          { baseVersionId: input.baseVersionId, title: input.title ?? page.title, bodyMd: input.bodyMd },
          { createdBy: agent.user.id, oauthGrantId: agent.grantId },
        );
      });
      const page = await findLivePage(db, wiki.id, input.pageId);
      return { id: page.id, headVersionId: page.headVersionId };
    },
  }),
  tool({
    name: "move_page",
    description:
      "ページを別の親の下（null なら最上位）の末尾へ移す。子ページも一緒に移る。",
    scope: "wiki.write",
    input: z.object({
      wiki: wikiKey,
      pageId,
      newParentPageId: pageId.nullable(),
    }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("移すページの ID"),
        newParentPageId: { type: ["string", "null"], description: "新しい親ページの ID。null なら最上位" },
      },
      ["wiki", "pageId", "newParentPageId"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      await visiblePage(db, agent, wiki.id, input.pageId);
      if (input.newParentPageId) await visiblePage(db, agent, wiki.id, input.newParentPageId);
      await assertSubtreeVisible(db, agent, wiki.id, input.pageId);
      const tree = await getPrimaryTree(db, wiki.id);
      await changeStructure(db, wiki.id, {
        ops: [{ type: "move", treeId: tree.id, nodeId: input.pageId, newParentNodeId: input.newParentPageId }],
        oauthGrantId: agent.grantId,
        recordPublishEvent: true,
      });
      return { ok: true };
    },
  }),
  tool({
    name: "set_page_cover",
    description:
      "ページのカバー画像（タイトルの上に出す横長の画像）を付ける・変える・外す。版は作らず、すぐに反映する。" +
      "画像は imageBase64（PNG・JPEG・WebP の中身を base64 にしたもの、5MB まで）で送るとアップロードして付ける。" +
      "アップロード済みの画像（/images/…）か用意した画像（/covers/{key}.svg）を付けるなら cover にパスを、外すなら cover に null を渡す。" +
      "公開中・限定公開中のページは公開サイトにもすぐ出るので、wiki.publish の許可も要る。",
    scope: "wiki.write",
    input: z
      .object({
        wiki: wikiKey,
        pageId,
        imageBase64: z.string().min(1).max(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 4).optional(),
        cover: pageCoverSchema.nullable().optional(),
      })
      .refine((v) => (v.imageBase64 === undefined) !== (v.cover === undefined), { message: "pass exactly one of imageBase64 or cover" }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        imageBase64: str("カバーにする画像の中身（PNG・JPEG・WebP を base64 にしたもの。5MB まで）。cover とどちらか一方"),
        cover: {
          type: ["string", "null"],
          description: "アップロード済みの画像のパス（/images/…）か用意した画像（/covers/{key}.svg）。null で外す。imageBase64 とどちらか一方",
        },
      },
      ["wiki", "pageId"],
    ),
    async run({ db, agent, images }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      // カバーは版に入らず、公開中のページなら公開サイトにすぐ出る。公開する許可が無いアプリには、公開側を変えさせない
      if (page.publishedVersionId !== null && page.visibility !== "private" && !agent.scopes.includes("wiki.publish")) {
        throw new HttpError(403, "insufficient_scope", "this page is published; changing its cover needs wiki.publish");
      }
      let cover = input.cover ?? null;
      if (input.imageBase64 !== undefined) {
        if (!images) throw new HttpError(503, "images_not_configured", "image storage is not configured");
        const body = new Uint8Array(Buffer.from(input.imageBase64.replace(/^data:[^,]*,/, ""), "base64"));
        if (body.byteLength > IMAGE_MAX_BYTES) {
          throw new HttpError(413, "image_too_large", `images must be ${IMAGE_MAX_BYTES} bytes or smaller`, { maxBytes: IMAGE_MAX_BYTES });
        }
        const type = sniffImageType(body);
        if (!type || !(COVER_UPLOAD_TYPES as readonly string[]).includes(type)) {
          throw new HttpError(415, "unsupported_image_type", "covers must be PNG, JPEG or WebP images");
        }
        const name = newImageName(type);
        await images.put(name, body, type);
        cover = `/images/${name}`;
      }
      await db.transaction((tx) => setPageCover(tx, wiki.id, page.id, cover));
      return { id: page.id, cover };
    },
  }),
  tool({
    name: "publish_page",
    description:
      "ページを公開する（すぐに公開サイトへ反映する）。versionId を省くと最新の版を公開する。公開後の編集は、もう一度公開するまで公開側に出ない。" +
      "公開範囲は親より広くできない。配下にこれより広く公開中のページがあると止まるので、applyToDescendants で配下もそろえる。" +
      "一度も公開したことの無いページを公開したときは、「初めて公開されたとき」で動くワークフローの実行を積んで動かす（管理画面から公開したときと同じ）。",
    scope: "wiki.publish",
    input: z.object({
      wiki: wikiKey,
      pageId,
      versionId: z.string().uuid().optional(),
      visibility: publishVisibilitySchema.default("public"),
      applyToDescendants: z.boolean().default(false),
    }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        versionId: str("公開する版（省略すると get_page で返す版）"),
        visibility: { type: "string", enum: ["public", "unlisted"], description: "public（公開）か unlisted（限定公開）。既定は public" },
        applyToDescendants: { type: "boolean", description: "配下で公開中のページの公開範囲も、これにそろえる。既定は false" },
      },
      ["wiki", "pageId"],
    ),
    async run({ db, config, agent, routineFetch, defer }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      if (input.applyToDescendants) await assertSubtreeVisible(db, agent, wiki.id, page.id);
      const versionId = await usableVersion(db, agent, page.id, input.versionId);
      const runIds = await db.transaction((tx) =>
        publishAudited(
          tx,
          {
            wikiId: wiki.id,
            pageId: page.id,
            versionId,
            visibility: input.visibility,
            applyToDescendants: input.applyToDescendants,
            oauthGrantId: agent.grantId,
          },
          agentActor(agent),
        ),
      );
      // 初めての公開で積んだワークフローの実行は、応答を待たせずに裏で動かす（管理画面から公開したときと同じ）
      runAfterResponse(db, { config, routineFetch, defer }, runIds);
      return { id: page.id, publishedVersionId: versionId, visibility: input.visibility };
    },
  }),
  tool({
    name: "unpublish_page",
    description: "ページの公開をやめ、非公開に戻す。配下に公開中のページがあると止まるので、applyToDescendants で配下もまとめて非公開にする。",
    scope: "wiki.publish",
    input: z.object({ wiki: wikiKey, pageId, applyToDescendants: z.boolean().default(false) }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        applyToDescendants: { type: "boolean", description: "配下で公開中のページも、まとめて非公開にする。既定は false" },
      },
      ["wiki", "pageId"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      if (input.applyToDescendants) await assertSubtreeVisible(db, agent, wiki.id, page.id);
      await db.transaction((tx) =>
        unpublishAudited(tx, wiki.id, page.id, { applyToDescendants: input.applyToDescendants, oauthGrantId: agent.grantId }, agentActor(agent)),
      );
      return { id: page.id, visibility: "private" };
    },
  }),
  tool({
    name: "list_schedule",
    description: "これからの公開・非公開化の予約を、時刻の早い順に返す。",
    scope: "wiki.publish",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const actions = await listActions(
        db,
        wiki.id,
        and(eq(scheduledActions.status, "scheduled"), gte(scheduledActions.runAt, new Date())),
      );
      // タイトルも、読める版のものを出す
      const titles = new Map(
        actions.length === 0
          ? []
          : (
              await db
                .select({ id: pages.id, title: pageVersions.title })
                .from(pages)
                .innerJoin(pageVersions, eq(pageVersions.id, readableVersionId(agent)))
                .where(and(inArray(pages.id, actions.map((a) => a.pageId!).filter(Boolean)), visibleTo(agent)))
            ).map((p) => [p.id, p.title]),
      );
      return {
        actions: actions
          .filter((a) => a.pageId && titles.has(a.pageId))
          .map((a) => ({
            id: a.id,
            actionType: a.actionType,
            pageId: a.pageId,
            pageTitle: titles.get(a.pageId!),
            versionId: a.versionId,
            targetVisibility: a.targetVisibility,
            runAt: a.runAt,
            editedAfterSchedule: a.editedAfterSchedule,
          })),
      };
    },
  }),
  tool({
    name: "schedule_page",
    description:
      "公開（publish_page）または非公開化（unpublish_page）を予約する。公開の予約は、その時点の版（versionId を省くと最新の版）を固定し、予約後の編集は含めない。runAt は未来の日時（ISO 8601、例 2026-10-20T08:00:00+09:00）。",
    scope: "wiki.publish",
    input: z.object({
      wiki: wikiKey,
      pageId,
      action: z.enum(["publish_page", "unpublish_page"]),
      runAt: z.string().datetime({ offset: true }),
      versionId: z.string().uuid().optional(),
      visibility: publishVisibilitySchema.default("public"),
    }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        action: { type: "string", enum: ["publish_page", "unpublish_page"], description: "公開か非公開化か" },
        runAt: str("実行する日時（ISO 8601、時差つき）"),
        versionId: str("公開する版（公開のときだけ。省略すると get_page で返す版）"),
        visibility: { type: "string", enum: ["public", "unlisted"], description: "公開のときの公開範囲。既定は public" },
      },
      ["wiki", "pageId", "action", "runAt"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const runAt = new Date(input.runAt);
      const versionId = input.action === "publish_page" ? await usableVersion(db, agent, page.id, input.versionId) : undefined;
      const action = await createSchedule(
        db,
        wiki.id,
        input.action === "publish_page"
          ? {
              actionType: "publish_page",
              pageId: page.id,
              versionId: versionId!,
              targetVisibility: input.visibility,
              runAt,
            }
          : { actionType: "unpublish_page", pageId: page.id, runAt },
        { actor: agentActor(agent), oauthGrantId: agent.grantId },
      );
      return { id: action.id, actionType: action.actionType, runAt: action.runAt, versionId: action.versionId };
    },
  }),
  tool({
    name: "cancel_schedule",
    description: "予約を取り消す（list_schedule で返す id を渡す）。",
    scope: "wiki.publish",
    input: z.object({ wiki: wikiKey, scheduleId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, scheduleId: str("予約の ID") }, ["wiki", "scheduleId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const [row] = await db
        .select({ pageId: scheduledActions.pageId })
        .from(scheduledActions)
        .where(and(eq(scheduledActions.wikiId, wiki.id), eq(scheduledActions.id, input.scheduleId)));
      if (!row?.pageId) throw notFound("scheduled action");
      await visiblePage(db, agent, wiki.id, row.pageId);
      const action = await cancelSchedule(db, wiki.id, input.scheduleId, agentActor(agent));
      return { id: action.id, status: action.status };
    },
  }),
  tool({
    name: "delete_page",
    description:
      "ページを削除する（ゴミ箱に入れる）。配下のページもいっしょにゴミ箱に入り、ツリーから外れる。公開中なら公開サイトからも消え（410）、予約は取り消される。" +
      "restore_page で配下ごと元に戻せる（公開と予約は戻らない）。完全に削除できるのは、管理画面の人だけ。",
    scope: "wiki.delete",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      await assertSubtreeVisible(db, agent, wiki.id, page.id);
      const { trashedPageIds } = await db.transaction((tx) => deletePage(tx, wiki.id, page.id, { actor: agentActor(agent), oauthGrantId: agent.grantId }));
      return { id: page.id, deleted: true, trashedPages: trashedPageIds.length };
    },
  }),
  tool({
    name: "list_trash",
    description:
      "ゴミ箱の一覧を、ゴミ箱に入れた日時の新しい順に返す。delete_page で選んだページごとに1件で、descendantCount はいっしょに入った配下のページ数。" +
      "非公開のページも読む許可が無いと、その許可で作ったページだけを返す。",
    scope: "wiki.delete",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      return { pages: await listTrash(db, wiki.id, visibleTo(agent)) };
    },
  }),
  tool({
    name: "restore_page",
    description:
      "ゴミ箱のページを、いっしょに入った配下ごと元に戻す（list_trash で返す id を渡す）。元の親ページが残っていればその下の末尾、無ければ最上位の末尾に戻る（parentMissing が true）。" +
      "戻したページは非公開のままで、公開と予約は戻らない。",
    scope: "wiki.delete",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ゴミ箱のページの ID（list_trash で返す id）") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const result = await db.transaction(async (tx) => {
        // 読めないページは無いものとして扱い、配下に読めないページがあれば止める（delete_page と同じ）
        const { members } = await lockTrashGroup(tx, wiki.id, input.pageId);
        const cond = visibleTo(agent);
        if (cond) {
          const ids = members.map((m) => m.id);
          const seen = new Set((await tx.select({ id: pages.id }).from(pages).where(and(inArray(pages.id, ids), cond))).map((p) => p.id));
          if (!seen.has(input.pageId)) throw notFound(`page ${input.pageId} in the trash`);
          if (seen.size < ids.length) {
            throw new HttpError(403, "insufficient_scope", "pages under this page are not visible to this connection (needs wiki.private)");
          }
        }
        return restorePage(tx, wiki.id, input.pageId, { actor: agentActor(agent), oauthGrantId: agent.grantId });
      });
      const { restoredPageIds, ...placed } = result;
      return { id: input.pageId, restored: true, restoredPages: restoredPageIds.length, ...placed };
    },
  }),
  tool({
    name: "list_tags",
    description: "その wiki のタグの名前の一覧（名前順）。add_tag と remove_tag には、ここにある名前を渡す。タグは管理画面で作る（ここからは作れない）。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      return { tags: (await listTags(db, wiki.id)).map((t) => t.name) };
    },
  }),
  tool({
    name: "add_tag",
    description:
      "ページにタグを付ける。タグは list_tags にある名前で、無い名前は断る（ここからタグは作れない）。すでに付いていれば何もせず成功を返す。" +
      "そのタグが付いたときに動くワークフローがあれば、その実行を積んで動かす（管理画面から付けたときと同じ）。同じページ・同じブロックの実行が1時間に5回を超えると、積まずに失敗として記録する。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, tag: z.string().min(1).max(100) }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), tag: str("タグの名前（list_tags で分かる）") }, ["wiki", "pageId", "tag"]),
    async run({ db, config, agent, routineFetch, defer }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const tag = await findTagByName(db, wiki.id, input.tag);
      const runIds = await db.transaction((tx) => attachTagAndEnqueue(tx, wiki.id, page.id, tag.id, agentActor(agent)));
      // 積んだ実行は、応答を待たせずに裏で動かす（管理画面から付けたときと同じ）
      runAfterResponse(db, { config, routineFetch, defer }, runIds);
      return { id: page.id, tags: (await pageTagList(db, page.id)).tags.map((t) => t.name) };
    },
  }),
  tool({
    name: "remove_tag",
    description: "ページからタグを外す。付いていなければ何もせず成功を返す。外してもワークフローの実行は積まない。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, tag: z.string().min(1).max(100) }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), tag: str("タグの名前（list_tags で分かる）") }, ["wiki", "pageId", "tag"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const tag = await findTagByName(db, wiki.id, input.tag);
      await db.transaction((tx) => detachTag(tx, wiki.id, page.id, tag.id, agentActor(agent)));
      return { id: page.id, tags: (await pageTagList(db, page.id)).tags.map((t) => t.name) };
    },
  }),
  tool({
    name: "create_edit_request",
    description:
      "ページの本文に、箇所ごとの「こう直す」を提案する（編集リクエスト）。本文は変えず、人が管理画面で1件ずつ採用・却下を決める。" +
      "箇所は、get_page の bodyMd の行の範囲（startLine〜endLine。1から数え、両端を含む）で指し、その範囲を replacement で置き換える提案になる。" +
      "replacement を空の文字にすると、その行を消す提案になる。行を足すときは、隣の行を範囲に入れ、その行も replacement に書く。" +
      "直し方を示せないとき（根拠が不明、古いかもしれない、など）は、kind を note にして、replacement の代わりに body（プレーンテキスト。必須）を書くと、置き換え案の無い指摘になる。" +
      "指摘は採用・却下の対象にならず、人が解決済みにする。" +
      "baseVersionId は get_page の headVersionId。最新の版でなければエラー（version_conflict）を返すので、get_page で読み直してから出し直す。" +
      `1回に ${EDIT_REQUEST_LIMITS.items} 件まで。出したあとは書き換えられない（直すときは withdraw_edit_request で取り下げて出し直す）。`,
    scope: "wiki.suggest",
    input: z.object({ wiki: wikiKey, pageId }).merge(createEditRequestInput),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        baseVersionId: str("get_page で返した headVersionId"),
        comment: str("全体へのひとこと（省略可）", { maxLength: EDIT_REQUEST_LIMITS.comment }),
        items: {
          type: "array",
          minItems: 1,
          maxItems: EDIT_REQUEST_LIMITS.items,
          description: "箇所ごとの提案（kind を省くか suggestion）と指摘（kind が note）",
          items: schema(
            {
              kind: { type: "string", enum: [...EDIT_REQUEST_ITEM_KINDS], description: "suggestion: 提案（replacement が必須。省くとこれ） / note: 指摘（body が必須。replacement と reason は渡さない）" },
              startLine: { type: "integer", minimum: 1, description: "範囲の最初の行（1から数える）" },
              endLine: { type: "integer", minimum: 1, description: "範囲の最後の行（この行も含む。1行だけなら startLine と同じ）" },
              replacement: str("提案：置き換える文面（Markdown）。空の文字なら、その行を消す", { maxLength: EDIT_REQUEST_LIMITS.replacement }),
              reason: str("提案：理由（省略可）", { maxLength: EDIT_REQUEST_LIMITS.reason }),
              body: str("指摘：本文（プレーンテキスト。Markdown としては描かれない）", { maxLength: EDIT_REQUEST_LIMITS.note }),
            },
            ["startLine", "endLine"],
          ),
        },
      },
      ["wiki", "pageId", "baseVersionId", "items"],
    ),
    async run({ db, agent }, { wiki: key, pageId: id, ...input }) {
      const wiki = await memberWiki(db, agent, key);
      return db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, id);
        // 読めていない版には提案させない（update_page と同じ）
        await assertNoHiddenEdits(tx, agent, page);
        const made = await createEditRequest(tx, { wikiId: wiki.id, pageId: page.id, input, actor: { userId: agent.user.id, oauthGrantId: agent.grantId } });
        return { id: made.id, pageId: page.id, itemIds: made.itemIds };
      });
    },
  }),
  tool({
    name: "list_edit_requests",
    description:
      "ページの編集リクエストを、新しい順に返す（項目の数を、状態ごとに付ける。open: 未対応 / accepted: 採用 / rejected: 却下 / resolved: 解決済み / withdrawn: 取り下げ）。" +
      "中身は get_edit_request で読む。非公開のページも読む許可が無いと、その許可で出したリクエストだけを返す。",
    scope: "wiki.suggest",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const { requests } = await listEditRequests(db, page, { oauthGrantId: ownRequestsOnly(agent) });
      return {
        requests: requests.map((r) => ({
          id: r.id,
          comment: r.comment,
          createdBy: r.createdBy.name,
          via: r.via,
          createdAt: r.createdAt,
          items: {
            open: r.items.filter((i) => i.status === "open").length,
            accepted: r.items.filter((i) => i.status === "accepted").length,
            rejected: r.items.filter((i) => i.status === "rejected").length,
            resolved: r.items.filter((i) => i.status === "resolved").length,
            withdrawn: r.items.filter((i) => i.status === "withdrawn").length,
          },
        })),
      };
    },
  }),
  tool({
    name: "get_edit_request",
    description:
      "編集リクエスト1件と、その項目（種類・行の範囲・元の文面・置き換え案と理由（提案）・本文（指摘）・状態・返信）を返す。startLine / endLine は、出したときの版（baseVersionId）での行。" +
      "未対応の項目の stale が null でなければ、その箇所があとから書き換えられていて、提案はもう採用できない（not_found: 元の文面が無い / ambiguous: 同じ文面が複数ある）。" +
      "項目ごとの comments が、人やアプリからの返信（古い順）。返信するときは reply_edit_request_item。",
    scope: "wiki.suggest",
    input: z.object({ wiki: wikiKey, pageId, requestId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), requestId: str("編集リクエストの ID（list_edit_requests で分かる）") }, ["wiki", "pageId", "requestId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const { requests, headVersionId } = await listEditRequests(db, page, { requestId: input.requestId, oauthGrantId: ownRequestsOnly(agent) });
      const request = requests[0];
      if (!request) throw notFound("edit request");
      // 最新の版を読めないアプリには、最新の版での行の位置を教えない
      const hidden = (await readableVersion(db, agent, page.id)) !== page.headVersionId;
      return { ...describeRequest(request, hidden), headVersionId: hidden ? null : headVersionId };
    },
  }),
  tool({
    name: "withdraw_edit_request",
    description: "その許可で出した編集リクエストの、未対応の項目（提案も指摘も）をまとめて取り下げる（採用・却下・解決済みの項目は変わらない）。ほかの人やアプリが出したものは取り下げられない。",
    scope: "wiki.suggest",
    input: z.object({ wiki: wikiKey, pageId, requestId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), requestId: str("編集リクエストの ID") }, ["wiki", "pageId", "requestId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const result = await db.transaction((tx) =>
        withdrawEditRequest(tx, {
          wikiId: wiki.id,
          pageId: page.id,
          requestId: input.requestId,
          actor: { userId: agent.user.id, oauthGrantId: agent.grantId },
          byGrantOnly: true,
        }),
      );
      return { id: input.requestId, withdrawn: result.withdrawn };
    },
  }),
  tool({
    name: "accept_edit_request_item",
    description:
      "編集リクエストの提案を1件採用する（指摘は採用できない。resolve_edit_request_item で解決済みにする）：最新の版の該当行を置き換えて、新しい版を作る（公開中のページでも、公開側は人が公開し直すまで変わらない）。" +
      "その箇所があとから書き換えられていると採用できない（edit_request_stale）。編集中の人の下書きとぶつかるときも止まる（draft_conflict）。" +
      "項目の ID は get_edit_request で分かる（読むには wiki.suggest の許可が要る）。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, itemId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), itemId: str("項目の ID（get_edit_request で分かる）") }, ["wiki", "pageId", "itemId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      return db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, input.pageId);
        await assertNoHiddenEdits(tx, agent, page);
        await assertItemReadable(tx, agent, page.id, input.itemId);
        const result = await acceptEditRequestItems(tx, {
          wikiId: wiki.id,
          pageId: page.id,
          target: { itemId: input.itemId },
          actor: { userId: agent.user.id, oauthGrantId: agent.grantId },
        });
        return { id: input.itemId, status: "accepted", headVersionId: result.headVersionId };
      });
    },
  }),
  tool({
    name: "reject_edit_request_item",
    description: "編集リクエストの提案を1件却下する（本文は変わらない。指摘は却下できない）。却下した項目は、管理画面で人が未対応に戻せる。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, itemId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), itemId: str("項目の ID（get_edit_request で分かる）") }, ["wiki", "pageId", "itemId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      await db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, input.pageId);
        await assertItemReadable(tx, agent, page.id, input.itemId);
        await rejectEditRequestItem(tx, { wikiId: wiki.id, pageId: page.id, itemId: input.itemId, actor: { userId: agent.user.id, oauthGrantId: agent.grantId } });
      });
      return { id: input.itemId, status: "rejected" };
    },
  }),
  tool({
    name: "reply_edit_request_item",
    description:
      "編集リクエストの項目（提案・指摘）に返信する。本文はプレーンテキスト（Markdown としては描かれない。改行は残る）。" +
      "採用・却下・解決済み・取り下げが済んだ項目にも返信できる。書いた返信は、書き換えも削除もできない。" +
      "項目の ID と、これまでの返信は get_edit_request で分かる。非公開のページも読む許可が無いと、その許可で出したリクエストの項目にだけ返信できる。",
    scope: "wiki.suggest",
    input: z.object({ wiki: wikiKey, pageId, itemId: z.string().uuid() }).merge(editRequestCommentInput),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        itemId: str("項目の ID（get_edit_request で分かる）"),
        body: str("返信の本文（プレーンテキスト）", { minLength: 1, maxLength: EDIT_REQUEST_LIMITS.reply }),
      },
      ["wiki", "pageId", "itemId", "body"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      return db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, input.pageId);
        await assertItemReadable(tx, agent, page.id, input.itemId);
        const made = await addEditRequestComment(tx, {
          wikiId: wiki.id,
          pageId: page.id,
          itemId: input.itemId,
          body: input.body,
          actor: { userId: agent.user.id, oauthGrantId: agent.grantId },
        });
        return { id: made.id, itemId: made.itemId, createdAt: made.createdAt };
      });
    },
  }),
  tool({
    name: "resolve_edit_request_item",
    description:
      "編集リクエストの指摘（kind が note の項目）を1件、解決済みにする（本文は変わらない）。提案は解決済みにできない（採用か却下で決める）。" +
      "指している箇所があとから書き換えられていても（stale）、解決済みにできる。解決済みにした指摘は、管理画面で人が未対応に戻せる。",
    scope: "wiki.write",
    input: z.object({ wiki: wikiKey, pageId, itemId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID"), itemId: str("項目の ID（get_edit_request で分かる）") }, ["wiki", "pageId", "itemId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      await db.transaction(async (tx) => {
        const page = await visiblePage(tx, agent, wiki.id, input.pageId);
        await assertItemReadable(tx, agent, page.id, input.itemId);
        await resolveEditRequestItem(tx, { wikiId: wiki.id, pageId: page.id, itemId: input.itemId, actor: { userId: agent.user.id, oauthGrantId: agent.grantId } });
      });
      return { id: input.itemId, status: "resolved" };
    },
  }),
  // ---------------------------------------------------------------------------
  // wiki の作成と設定（wiki.admin）。許可した人のロールの範囲でだけ効く：
  // wiki を作るのはオーナー、タグとワークフローを変えるのはその wiki の管理者（オーナーはどの wiki でも管理者）
  // ---------------------------------------------------------------------------
  tool({
    name: "create_wiki",
    description:
      "wiki を作る（許可した人がオーナーのときだけ）。空のツリーを1本用意し、許可した人をその wiki の管理者にする。" +
      "key は公開サイトのサブドメインになる名前で、作ったあとは変えられない（半角の英小文字・数字・ハイフン、3〜32文字、先頭は英字、末尾はハイフン以外。使用中・予約済みの名前は使えない）。name は表示名。",
    scope: "wiki.admin",
    input: createWikiInput.pick({ key: true, name: true }),
    inputSchema: schema({ key: str("公開サイトのサブドメインになる名前（作ったあとは変えられない）"), name: str("wiki の表示名") }, ["key", "name"]),
    async run({ db, config, agent }, input) {
      if (!agent.user.isOwner) throw new HttpError(403, "owner_only", "only owners can create wikis");
      const row = await createWiki(db, input, agent.user, agentActor(agent));
      return { key: row.key, name: row.name, adminUrl: `${config.adminOrigin}/w/${row.key}`, siteUrl: wikiOrigin(row.key, config.siteBaseDomain) };
    },
  }),
  tool({
    name: "create_tag",
    description: "その wiki にタグを作る（その wiki の管理者だけ）。同じ名前のタグがあればエラー（tag_exists）。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }).merge(createTagInput),
    inputSchema: schema({ ...WIKI_PROP, name: str("タグの名前") }, ["wiki", "name"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const tag = await db.transaction((tx) => createTag(tx, wiki.id, input.name, agentActor(agent)));
      return { name: tag.name };
    },
  }),
  tool({
    name: "rename_tag",
    description: "タグの名前を変える（その wiki の管理者だけ）。付いているページと、ワークフローのブロックは、そのまま新しい名前で続く。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, tag: z.string().min(1).max(100) }).merge(renameTagInput),
    inputSchema: schema({ ...WIKI_PROP, tag: str("いまのタグの名前"), name: str("新しい名前") }, ["wiki", "tag", "name"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const tag = await findTagByName(db, wiki.id, input.tag);
      await db.transaction((tx) => renameTag(tx, wiki.id, tag.id, input.name, agentActor(agent)));
      return { name: input.name };
    },
  }),
  tool({
    name: "delete_tag",
    description:
      "タグを消す（その wiki の管理者だけ）。ページからも外れる。そのタグがトリガーのブロックは消え、そのタグを付ける・外すアクションは取り除かれ、アクションが無くなったブロックも消える。元に戻せない。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, tag: z.string().min(1).max(100) }),
    inputSchema: schema({ ...WIKI_PROP, tag: str("タグの名前") }, ["wiki", "tag"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const tag = await findTagByName(db, wiki.id, input.tag);
      await db.transaction((tx) => deleteTag(tx, wiki.id, tag.id, agentActor(agent)));
      return { deleted: input.tag };
    },
  }),
  tool({
    name: "list_routines",
    description:
      "ワークフローの「Routine を呼ぶ」で選べる Routine の名前の一覧（その wiki の管理者だけ）。Routine の登録は管理画面の「全体の管理」の「Routine」タブで、オーナーが行う（ここからは登録できない）。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      await adminWiki(db, agent, input.wiki);
      return { routines: (await listRoutineChoices(db)).map((r) => r.name) };
    },
  }),
  tool({
    name: "list_workflows",
    description:
      "その wiki のワークフローと、それぞれのブロック（トリガーとアクションの並び）を返す（その wiki の管理者だけ）。" +
      "ブロックのトリガーとアクションは、create_workflow_block に渡すのと同じ形（タグと Routine は名前）で返す。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const list = await listWorkflows(db, wiki.id);
      return {
        workflows: await Promise.all(
          list.map(async (w) => ({ id: w.id, name: w.name, blocks: (await listBlocks(db, wiki.id, w.id)).map(describeBlock) })),
        ),
      };
    },
  }),
  tool({
    name: "create_workflow",
    description: `ワークフローを作る（その wiki の管理者だけ）。名前は同じ wiki の中で重ねられない。1つの wiki に ${WORKFLOWS_MAX} 個まで。ブロックは create_workflow_block で足す。`,
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }).merge(workflowInput),
    inputSchema: schema({ ...WIKI_PROP, name: str("ワークフローの名前（例：記事の下書き）") }, ["wiki", "name"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const made = await db.transaction((tx) => createWorkflow(tx, wiki.id, { name: input.name }, agentActor(agent)));
      return { id: made.id, name: made.name };
    },
  }),
  tool({
    name: "rename_workflow",
    description: "ワークフローの名前を変える（その wiki の管理者だけ）。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, workflowId: z.string().uuid() }).merge(workflowInput),
    inputSchema: schema({ ...WIKI_PROP, workflowId: str("ワークフローの ID（list_workflows で分かる）"), name: str("新しい名前") }, ["wiki", "workflowId", "name"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const renamed = await db.transaction((tx) => renameWorkflow(tx, wiki.id, input.workflowId, { name: input.name }, agentActor(agent)));
      return { id: renamed.id, name: renamed.name };
    },
  }),
  tool({
    name: "delete_workflow",
    description: "ワークフローを消す（その wiki の管理者だけ）。ブロックと実行の履歴もいっしょに消え、元に戻せない。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, workflowId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, workflowId: str("ワークフローの ID（list_workflows で分かる）") }, ["wiki", "workflowId"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      await db.transaction((tx) => deleteWorkflow(tx, wiki.id, input.workflowId, agentActor(agent)));
      return { deleted: input.workflowId };
    },
  }),
  tool({
    name: "create_workflow_block",
    description: BLOCK_DESCRIPTION + "ブロックを足す（その wiki の管理者だけ）。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, workflowId: z.string().uuid() }).merge(namedBlockInput),
    inputSchema: schema({ ...WIKI_PROP, workflowId: str("ワークフローの ID（list_workflows で分かる）"), ...BLOCK_PROPS }, ["wiki", "workflowId", "trigger", "actions"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const block = await db.transaction(async (tx) => {
        const workflow = await findWorkflow(tx, wiki.id, input.workflowId);
        return createBlock(tx, wiki.id, workflow.id, await resolveBlock(tx, agent, wiki.id, input), agentActor(agent));
      });
      return describeBlock(block);
    },
  }),
  tool({
    name: "update_workflow_block",
    description: BLOCK_DESCRIPTION + "ブロックを、渡したトリガーとアクションの並びで置き換える（その wiki の管理者だけ）。積んであった実行は、積んだ時点の内容のまま動く。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, workflowId: z.string().uuid(), blockId: z.string().uuid() }).merge(namedBlockInput),
    inputSchema: schema(
      { ...WIKI_PROP, workflowId: str("ワークフローの ID"), blockId: str("ブロックの ID（list_workflows で分かる）"), ...BLOCK_PROPS },
      ["wiki", "workflowId", "blockId", "trigger", "actions"],
    ),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      const block = await db.transaction(async (tx) => {
        const workflow = await findWorkflow(tx, wiki.id, input.workflowId);
        return replaceBlock(tx, wiki.id, workflow.id, input.blockId, await resolveBlock(tx, agent, wiki.id, input), agentActor(agent));
      });
      return describeBlock(block);
    },
  }),
  tool({
    name: "delete_workflow_block",
    description: "ブロックを消す（その wiki の管理者だけ）。実行の履歴は残る。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey, workflowId: z.string().uuid(), blockId: z.string().uuid() }),
    inputSchema: schema({ ...WIKI_PROP, workflowId: str("ワークフローの ID"), blockId: str("ブロックの ID（list_workflows で分かる）") }, ["wiki", "workflowId", "blockId"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      await db.transaction(async (tx) => {
        const workflow = await findWorkflow(tx, wiki.id, input.workflowId);
        await deleteBlock(tx, wiki.id, workflow.id, input.blockId, agentActor(agent));
      });
      return { deleted: input.blockId };
    },
  }),
  tool({
    name: "get_home",
    description:
      "公開サイトのトップ（/）の設定を読む（その wiki の管理者だけ）。introMd（自由記述の Markdown）と、グリッドに置いたブロック blocks（置いていなければ null）を返す。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      return resolveHome(wiki.home);
    },
  }),
  tool({
    name: "update_home",
    description:
      "公開サイトのトップ（/）の設定を保存する（その wiki の管理者だけ）。introMd と blocks の全体を置き換える。保存するとすぐ公開サイトをビルドし直すので、公開してよい内容だけを渡す。" +
      "blocks は 12 列のマス目に置くブロックの並びで、null か省略なら置かない（自由記述の下に新着記事を縦に並べた今までの見た目）。" +
      "ブロックは id、kind（intro＝自由記述で 1 つだけ／latest＝新着記事）、col・row・colSpan・rowSpan（1 始まり。12 列、24 行まで）、limit（latest の件数。1〜50、null で全件。intro は null）を持つ。" +
      "最大 12 個で、重なる配置は 400（invalid_input）。まず get_home で今の設定を読んでから渡す。",
    scope: "wiki.admin",
    input: z.object({ wiki: wikiKey }).merge(updateHomeInput),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        introMd: str("自由記述（Markdown。1 万文字まで）。空文字なら何も出さない"),
        blocks: {
          type: ["array", "null"],
          description: "グリッドに置くブロック。null か省略で、置かない",
          maxItems: 12,
          items: schema(
            {
              id: str("ブロックの名前（40 文字まで。ブロック間で重ならない）"),
              kind: str("intro か latest", { enum: ["intro", "latest"] }),
              col: { type: "integer", minimum: 1, maximum: 12, description: "左端の列" },
              row: { type: "integer", minimum: 1, maximum: 24, description: "上端の行" },
              colSpan: { type: "integer", minimum: 1, maximum: 12, description: "幅（列の数）" },
              rowSpan: { type: "integer", minimum: 1, maximum: 24, description: "高さ（行の数）" },
              limit: { type: ["integer", "null"], minimum: 1, maximum: 50, description: "latest の件数。null で全件" },
            },
            ["id", "kind", "col", "row", "colSpan", "rowSpan", "limit"],
          ),
        },
      },
      ["wiki", "introMd"],
    ),
    async run({ db, agent }, input) {
      const wiki = await adminWiki(db, agent, input.wiki);
      return updateHome(db, wiki.id, { introMd: input.introMd, blocks: input.blocks }, agentActor(agent));
    },
  }),

];

export function toolsFor(agent: AgentContext) {
  return TOOLS.filter((t) => agent.scopes.includes(t.scope));
}

/** 道具を実行する。入力の誤りと、スコープの不足はここで弾く */
export async function callTool(ctx: ToolContext, name: string, args: unknown): Promise<unknown> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new HttpError(404, "unknown_tool", `unknown tool: ${name}`);
  if (!ctx.agent.scopes.includes(t.scope)) {
    throw new HttpError(403, "insufficient_scope", `this connection is not allowed to ${t.name} (needs ${t.scope})`);
  }
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) throw new HttpError(400, "invalid_input", "invalid arguments", parsed.error.issues);
  return (t.run as (ctx: ToolContext, input: unknown) => Promise<unknown>)(ctx, parsed.data);
}
