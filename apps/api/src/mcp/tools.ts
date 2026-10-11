import {
  bodyLines,
  createEditRequestInput,
  createPageInput,
  EDIT_REQUEST_ITEM_KINDS,
  EDIT_REQUEST_LIMITS,
  editRequestCommentInput,
  publishVisibilitySchema,
  savePageInput,
  type EditRequest,
  type OAuthScope,
} from "@wiki/shared";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { editRequestItems, editRequests, pages, pageVersions, scheduledActions } from "../db/schema";
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
import type { AgentContext } from "../oauth/service";
import { createPage, deletePage, findLivePage, listTrash, lockTrashGroup, restorePage, savePage } from "../routes/pages";
import { cancelSchedule, createSchedule, listActions, publishAudited, unpublishAudited } from "../routes/publishing";
import { agentActor } from "../audit/service";
import { descendantIds, loadTreeIndex } from "../publishing/hierarchy";
import { commitOps, getBranch, getPrimaryTree, loadCommit, MAIN_BRANCH } from "../structure/repo";
import { roleIn, rolesByWiki } from "../users/service";
import { findOpenWiki, listWikis } from "../wikis/service";

/**
 * MCP の道具。どれも Cookie の API と同じ処理（楽観ロック・構造のコミット・公開の記録）を通る。
 * 公開・予約は wiki.publish、削除（ゴミ箱に入れる・一覧・元に戻す）は wiki.delete を許したアプリだけが使える。
 * ゴミ箱から完全に削除する道具は置かない（完全に消せるのは、管理画面の人だけ）。
 * 編集リクエストを出す・読む・返信する・取り下げるのは wiki.suggest、採用・却下は本文が変わるので wiki.write（指摘を解決済みにするのも、人の代わりに片付ける操作なので wiki.write）。
 */
type ToolContext = { db: Db; config: AppConfig; agent: AgentContext };

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
    description: "ページをタイトルと本文から探す。query を省くと、更新の新しい順に返す。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey, query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(20) }),
    inputSchema: schema(
      { ...WIKI_PROP, query: str("探す語（省略可）"), limit: { type: "integer", minimum: 1, maximum: 100, description: "最大件数（既定 20）" } },
      ["wiki"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const q = input.query?.trim();
      const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
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
          ),
        )
        .orderBy(desc(pages.updatedAt))
        .limit(input.limit);
      return { pages: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
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
      };
    },
  }),
  tool({
    name: "get_tree",
    description:
      "ページのツリーを返す（親子と並び順）。読めないページはタイトルを伏せる。move_page には、ここで返す headCommitId を expectedHeadCommitId として渡す。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey }),
    inputSchema: schema(WIKI_PROP, ["wiki"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const branch = await getBranch(db, wiki.id, MAIN_BRANCH);
      const { state } = await loadCommit(db, branch.headCommitId);
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
        headCommitId: branch.headCommitId,
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
      "ページを別の親の下（null なら最上位）の末尾へ移す。子ページも一緒に移る。expectedHeadCommitId が最新でなければエラーを返すので、get_tree で読み直してからやり直す。",
    scope: "wiki.write",
    input: z.object({
      wiki: wikiKey,
      pageId,
      newParentPageId: pageId.nullable(),
      expectedHeadCommitId: z.string().uuid(),
    }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("移すページの ID"),
        newParentPageId: { type: ["string", "null"], description: "新しい親ページの ID。null なら最上位" },
        expectedHeadCommitId: str("get_tree で返した headCommitId"),
      },
      ["wiki", "pageId", "newParentPageId", "expectedHeadCommitId"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      await visiblePage(db, agent, wiki.id, input.pageId);
      if (input.newParentPageId) await visiblePage(db, agent, wiki.id, input.newParentPageId);
      await assertSubtreeVisible(db, agent, wiki.id, input.pageId);
      const tree = await getPrimaryTree(db, wiki.id);
      const result = await commitOps(db, wiki.id, {
        expectedHeadCommitId: input.expectedHeadCommitId,
        ops: [{ type: "move", treeId: tree.id, nodeId: input.pageId, newParentNodeId: input.newParentPageId }],
        createdBy: agent.user.id,
        oauthGrantId: agent.grantId,
        recordPublishEvent: true,
      });
      return { headCommitId: result.commitId };
    },
  }),
  tool({
    name: "publish_page",
    description:
      "ページを公開する（すぐに公開サイトへ反映する）。versionId を省くと最新の版を公開する。公開後の編集は、もう一度公開するまで公開側に出ない。" +
      "公開範囲は親より広くできない。配下にこれより広く公開中のページがあると止まるので、applyToDescendants で配下もそろえる。",
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
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      if (input.applyToDescendants) await assertSubtreeVisible(db, agent, wiki.id, page.id);
      const versionId = await usableVersion(db, agent, page.id, input.versionId);
      await db.transaction((tx) =>
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
