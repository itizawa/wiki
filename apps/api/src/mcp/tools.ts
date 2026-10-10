import { createPageInput, publishVisibilitySchema, savePageInput, type OAuthScope } from "@wiki/shared";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { pages, pageVersions, scheduledActions } from "../db/schema";
import { HttpError, notFound } from "../errors";
import type { AgentContext } from "../oauth/service";
import { createPage, deletePage, findLivePage, savePage, setWorkflow } from "../routes/pages";
import { cancelSchedule, createSchedule, listActions } from "../routes/publishing";
import { publishPage, unpublishPage } from "../publishing/service";
import { commitOps, getBranch, getPrimaryTree, loadCommit, MAIN_BRANCH } from "../structure/repo";
import { roleIn, rolesByWiki } from "../users/service";
import { findOpenWiki, listWikis } from "../wikis/service";

/**
 * MCP の道具。どれも Cookie の API と同じ処理（楽観ロック・構造のコミット・公開の記録）を通る。
 * 公開・予約・承認は wiki.publish、削除は wiki.delete を許したアプリだけが使える。
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

/**
 * wiki.private が無い許可で読めるページ：公開中のものと、その許可で作ったもの。
 * 1つのテーブルからの問い合わせでは列名にテーブル名が付かないので、相関する列は名前で書く
 */
function visibleTo(agent: AgentContext): SQL | undefined {
  if (agent.scopes.includes("wiki.private")) return undefined;
  return or(
    and(eq(pages.visibility, "public"), isNotNull(pages.publishedVersionId)),
    sql`exists (select 1 from "page_versions" v where v."page_id" = "pages"."id" and v."base_version_id" is null and v."oauth_grant_id" = ${agent.grantId})`,
  );
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
          title: pages.title,
          visibility: pages.visibility,
          workflowState: pages.workflowState,
          published: isNotNull(pages.publishedVersionId).mapWith(Boolean),
          updatedAt: pages.updatedAt,
        })
        .from(pages)
        .innerJoin(pageVersions, eq(pageVersions.id, pages.headVersionId))
        .where(
          and(
            eq(pages.wikiId, wiki.id),
            isNull(pages.deletedAt),
            visibleTo(agent),
            like ? or(ilike(pages.title, like), ilike(pageVersions.bodyMd, like)) : undefined,
          ),
        )
        .orderBy(desc(pages.updatedAt))
        .limit(input.limit);
      return { pages: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
    },
  }),
  tool({
    name: "get_page",
    description: "ページの最新の本文（Markdown）を返す。update_page には、ここで返す headVersionId を baseVersionId として渡す。",
    scope: "wiki.read",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const [head] = await db.select().from(pageVersions).where(eq(pageVersions.id, page.headVersionId));
      return {
        id: page.id,
        title: head!.title,
        bodyMd: head!.bodyMd,
        headVersionId: page.headVersionId,
        visibility: page.visibility,
        published: page.publishedVersionId !== null,
        workflowState: page.workflowState,
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
            .select({ id: pages.id, title: pages.title })
            .from(pages)
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
      },
      ["wiki", "title"],
    ),
    async run({ db, agent }, { wiki: key, ...input }) {
      const wiki = await memberWiki(db, agent, key);
      const id = await db.transaction((tx) => createPage(tx, wiki.id, input, { oauthGrantId: agent.grantId }));
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
        await savePage(
          tx,
          wiki.id,
          page.id,
          { baseVersionId: input.baseVersionId, title: input.title ?? page.title, bodyMd: input.bodyMd },
          { oauthGrantId: agent.grantId },
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
      const tree = await getPrimaryTree(db, wiki.id);
      const result = await commitOps(db, wiki.id, {
        expectedHeadCommitId: input.expectedHeadCommitId,
        ops: [{ type: "move", treeId: tree.id, nodeId: input.pageId, newParentNodeId: input.newParentPageId }],
        oauthGrantId: agent.grantId,
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
        versionId: str("公開する版（省略すると最新の版）"),
        visibility: { type: "string", enum: ["public", "unlisted"], description: "public（公開）か unlisted（限定公開）。既定は public" },
        applyToDescendants: { type: "boolean", description: "配下で公開中のページの公開範囲も、これにそろえる。既定は false" },
      },
      ["wiki", "pageId"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      // 配下をそろえると、見えていない限定公開のページを公開にしうる。非公開も見てよい許可があるときだけ
      if (input.applyToDescendants && input.visibility === "public" && !agent.scopes.includes("wiki.private")) {
        throw new HttpError(403, "insufficient_scope", "applyToDescendants with public needs wiki.private");
      }
      const versionId = input.versionId ?? page.headVersionId;
      await db.transaction((tx) =>
        publishPage(tx, {
          wikiId: wiki.id,
          pageId: page.id,
          versionId,
          visibility: input.visibility,
          applyToDescendants: input.applyToDescendants,
          oauthGrantId: agent.grantId,
        }),
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
      await db.transaction((tx) =>
        unpublishPage(tx, wiki.id, page.id, { applyToDescendants: input.applyToDescendants, oauthGrantId: agent.grantId }),
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
      const visible = new Set(
        actions.length === 0
          ? []
          : (
              await db
                .select({ id: pages.id })
                .from(pages)
                .where(and(inArray(pages.id, actions.map((a) => a.pageId!).filter(Boolean)), visibleTo(agent)))
            ).map((p) => p.id),
      );
      return {
        actions: actions
          .filter((a) => a.pageId && visible.has(a.pageId))
          .map((a) => ({
            id: a.id,
            actionType: a.actionType,
            pageId: a.pageId,
            pageTitle: a.pageTitle,
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
        versionId: str("公開する版（公開のときだけ。省略すると最新の版）"),
        visibility: { type: "string", enum: ["public", "unlisted"], description: "公開のときの公開範囲。既定は public" },
      },
      ["wiki", "pageId", "action", "runAt"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      const runAt = new Date(input.runAt);
      const action = await createSchedule(
        db,
        wiki.id,
        input.action === "publish_page"
          ? {
              actionType: "publish_page",
              pageId: page.id,
              versionId: input.versionId ?? page.headVersionId,
              targetVisibility: input.visibility,
              runAt,
            }
          : { actionType: "unpublish_page", pageId: page.id, runAt },
        { oauthGrantId: agent.grantId },
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
      const action = await cancelSchedule(db, wiki.id, input.scheduleId);
      return { id: action.id, status: action.status };
    },
  }),
  tool({
    name: "set_workflow_state",
    description:
      "記事の状態を変える：idea（ネタ）／draft（下書き）／approved（承認済み）。承認はその版（versionId を省くと最新の版）を固定し、予約枠に入れるルールの対象になる。",
    scope: "wiki.publish",
    input: z.object({ wiki: wikiKey, pageId, state: z.enum(["idea", "draft", "approved"]), versionId: z.string().uuid().optional() }),
    inputSchema: schema(
      {
        ...WIKI_PROP,
        pageId: str("ページの ID"),
        state: { type: "string", enum: ["idea", "draft", "approved"], description: "新しい状態" },
        versionId: str("承認する版（approved のときだけ。省略すると最新の版）"),
      },
      ["wiki", "pageId", "state"],
    ),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      await db.transaction((tx) =>
        setWorkflow(
          tx,
          wiki.id,
          page.id,
          input.state === "approved" ? { state: "approved", versionId: input.versionId ?? page.headVersionId } : { state: input.state },
        ),
      );
      const after = await findLivePage(db, wiki.id, page.id);
      return { id: page.id, workflowState: after.workflowState, approvedVersionId: after.approvedVersionId };
    },
  }),
  tool({
    name: "delete_page",
    description:
      "ページを削除する。子ページは1つ上の階層へ移る。公開中なら公開サイトからも消え（410）、予約は取り消される。元に戻す道具は無い。",
    scope: "wiki.delete",
    input: z.object({ wiki: wikiKey, pageId }),
    inputSchema: schema({ ...WIKI_PROP, pageId: str("ページの ID") }, ["wiki", "pageId"]),
    async run({ db, agent }, input) {
      const wiki = await memberWiki(db, agent, input.wiki);
      const page = await visiblePage(db, agent, wiki.id, input.pageId);
      await db.transaction((tx) => deletePage(tx, wiki.id, page.id, { oauthGrantId: agent.grantId }));
      return { id: page.id, deleted: true };
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
