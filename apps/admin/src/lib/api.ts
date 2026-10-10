import type {
  CreatedInvite,
  Invite,
  InvitePreview,
  Me,
  PageDetail,
  PageSummary,
  PageVersion,
  PublishVisibility,
  Rule,
  RuleRun,
  ScheduledAction,
  SetWorkflowInput,
  StructureChange,
  StructureOpInput,
  TreeMeta,
  TreeNode,
  UpdateRuleInput,
  User,
  WikiMember,
  WikiRole,
  WikiSummary,
} from "@wiki/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * いま開いている wiki の key。wiki の内容を扱う API（ページ・ツリー・予約・ルール）は、すべてこの wiki の経路を呼ぶ。
 * `/w/{key}/...` の画面（WikiLayout）が、子の画面を描く前に設定する。
 */
let wikiKey = "";

export function setApiWiki(key: string) {
  wikiKey = key;
}

export function currentWikiKey(): string {
  return wikiKey;
}

/** 開いている wiki の経路。 */
const w = (path: string) => `/admin/w/${encodeURIComponent(wikiKey)}${path}`;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? res.statusText, err.details);
  }
  return data as T;
}

export type VersionListItem = Pick<PageVersion, "id" | "baseVersionId" | "title" | "authorType" | "createdAt">;

export type StructureTree = TreeMeta & { nodes: TreeNode[] };
export type StructureResponse = {
  headCommitId: string;
  trees: StructureTree[];
  pages: Record<string, { id: string; title: string; visibility: string; publishedVersionId: string | null }>;
};

export type CommitListItem = { id: string; message: string | null; authorType: string; createdAt: string; parentIds: string[] };

export const api = {
  providers: () => request<{ google: boolean; devLogin: boolean }>("GET", "/auth/providers"),
  devLogin: () => request<{ email: string }>("POST", "/auth/dev-login"),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: () => request<Me>("GET", "/admin/me"),
  invitePreview: (token: string) => request<InvitePreview>("GET", `/auth/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ wikiKey: string; alreadyMember: boolean }>("POST", `/admin/invites/${encodeURIComponent(token)}/accept`),
  listUsers: () => request<{ users: User[] }>("GET", "/admin/users"),
  setOwner: (userId: string, isOwner: boolean) => request<User>("PATCH", `/admin/users/${userId}`, { isOwner }),

  listWikis: () => request<{ wikis: WikiSummary[]; baseDomain: string }>("GET", "/admin/wikis"),
  createWiki: (input: { key: string; name: string }) => request<WikiSummary>("POST", "/admin/wikis", input),
  updateWiki: (key: string, input: { name?: string; iconUrl?: string | null }) => request<WikiSummary>("PATCH", `/admin/wikis/${key}`, input),
  archiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/archive`),
  unarchiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/unarchive`),

  listMembers: () => request<{ members: WikiMember[] }>("GET", w("/members")),
  changeRole: (userId: string, role: WikiRole) => request<{ ok: true }>("PATCH", w(`/members/${userId}`), { role }),
  removeMember: (userId: string) => request<{ ok: true }>("DELETE", w(`/members/${userId}`)),
  listInvites: () => request<{ invites: Invite[] }>("GET", w("/invites")),
  createInvite: (role: WikiRole) => request<CreatedInvite>("POST", w("/invites"), { role }),
  revokeInvite: (id: string) => request<{ ok: true }>("POST", w(`/invites/${id}/revoke`)),
  listPages: (q?: string) =>
    request<{ pages: PageSummary[] }>("GET", w(`/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`)),
  createPage: (input: { title: string; bodyMd?: string; parentPageId?: string | null }) => request<PageDetail>("POST", w("/pages"), input),
  getPage: (id: string) => request<PageDetail>("GET", w(`/pages/${id}`)),
  savePage: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<PageDetail>("PUT", w(`/pages/${id}`), input),
  deletePage: (id: string) => request<{ ok: true }>("DELETE", w(`/pages/${id}`)),
  listVersions: (id: string) => request<{ versions: VersionListItem[] }>("GET", w(`/pages/${id}/versions`)),
  getVersion: (id: string, versionId: string) => request<PageVersion>("GET", w(`/pages/${id}/versions/${versionId}`)),

  setWorkflow: (id: string, input: SetWorkflowInput) => request<PageDetail>("POST", w(`/pages/${id}/workflow`), input),
  reviewDone: (id: string) => request<PageDetail>("POST", w(`/pages/${id}/review-done`)),

  publish: (id: string, input: { versionId: string; visibility: PublishVisibility }) =>
    request<{ ok: true }>("POST", w(`/pages/${id}/publish`), input),
  unpublish: (id: string) => request<{ ok: true }>("POST", w(`/pages/${id}/unpublish`)),
  rotateUnlistedKey: (id: string) => request<{ unlistedKey: string }>("POST", w(`/pages/${id}/unlisted-key`)),

  listSchedule: (params: { from?: string; to?: string; pageId?: string; status?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<{ actions: ScheduledAction[] }>("GET", w(`/schedule${q.size ? `?${q}` : ""}`));
  },
  createSchedule: (
    input:
      | { actionType: "publish_page"; pageId: string; versionId: string; targetVisibility: PublishVisibility; runAt: string; batchId?: string }
      | { actionType: "unpublish_page"; pageId: string; runAt: string; batchId?: string },
  ) => request<ScheduledAction>("POST", w("/schedule"), input),
  reschedule: (id: string, runAt: string) => request<ScheduledAction>("PATCH", w(`/schedule/${id}`), { runAt }),
  cancelSchedule: (id: string) => request<ScheduledAction>("POST", w(`/schedule/${id}/cancel`)),

  listRules: () => request<{ rules: Rule[] }>("GET", w("/rules")),
  saveRule: (id: string, input: UpdateRuleInput) => request<Rule>("PUT", w(`/rules/${id}`), input),
  listRuleRuns: () => request<{ runs: RuleRun[] }>("GET", w("/rules/runs")),

  structure: () => request<StructureResponse>("GET", w("/structure")),
  commit: (input: { expectedHeadCommitId: string; message?: string; ops: StructureOpInput[] }) =>
    request<{ commitId: string }>("POST", w("/structure/commits"), input),
  history: () => request<{ commits: CommitListItem[] }>("GET", w("/structure/commits")),
  commitDetail: (id: string) =>
    request<{ commit: CommitListItem; changes: StructureChange[] }>("GET", w(`/structure/commits/${id}`)),
  updateTree: (id: string, input: { name?: string; isPublic?: boolean }) =>
    request<TreeMeta>("PATCH", w(`/trees/${id}`), input),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "version_conflict":
        return "別の画面で先に保存されています。再読み込みしてから編集してください。";
      case "head_moved":
        return "ツリーが別の操作で更新されました。最新の状態を読み込みました。もう一度操作してください。";
      case "has_children":
        return "子があるため外せません。先に子を移動してください。";
      case "run_at_in_past":
        return "過去の日時は指定できません。";
      case "not_scheduled":
        return "実行中または実行済みのため変更できません。";
      case "wiki_key_taken":
        return "この key はすでに使われています（アーカイブ中の wiki を含みます）。別の key を入力してください。";
      case "wiki_not_found":
        return "この wiki は見つかりません。アーカイブされたか、URL が違います。";
      case "owner_only":
        return "wiki の作成・アーカイブは、オーナーだけが行えます。";
      case "cycle":
        return "自分自身や子孫の下には移動できません。";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
