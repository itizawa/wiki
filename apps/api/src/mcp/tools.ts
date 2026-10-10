import { createPageInput, savePageInput, type OAuthScope } from "@wiki/shared";
import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Db } from "../db/client";
import { pages, pageVersions } from "../db/schema";
import { HttpError, notFound } from "../errors";
import type { AgentContext } from "../oauth/service";
import { createPage, findLivePage, savePage } from "../routes/pages";
import { commitOps, getBranch, getPrimaryTree, loadCommit, MAIN_BRANCH } from "../structure/repo";
import { findOpenWiki, listWikis } from "../wikis/service";

/**
 * MCP の道具。どれも Cookie の API と同じ処理（楽観ロック・構造のコミット）を通る。
 * 公開・予約・承認・削除の道具は無い（外からの操作は下書きとして保存するところまで）。
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
    async run({ db, config }) {
      const wikis = await listWikis(db, config, { includeArchived: false });
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
      const wiki = await findOpenWiki(db, input.wiki);
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
      const wiki = await findOpenWiki(db, input.wiki);
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
      const wiki = await findOpenWiki(db, input.wiki);
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
    input: z.object({ wiki: wikiKey }).merge(createPageInput),
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
      const wiki = await findOpenWiki(db, key);
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
      const wiki = await findOpenWiki(db, input.wiki);
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
      const wiki = await findOpenWiki(db, input.wiki);
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
