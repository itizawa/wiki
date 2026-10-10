import type {
  Invite,
  InviteInfo,
  Me,
  Member,
  PageDetail,
  PageDraft,
  PageSummary,
  PageVersion,
  PublishVisibility,
  Rule,
  RuleRun,
  SearchResult,
  ScheduledAction,
  SetWorkflowInput,
  StructureChange,
  StructureOpInput,
  TreeMeta,
  TreeNode,
  UpdateRuleInput,
  UserSummary,
  WikiRole,
  WikiSummary,
} from "@wiki/shared";
import { IMAGE_LIMIT_LABEL } from "@wiki/shared";

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

  // 招待リンクを開いた人向け（ログインしていなくても呼べる）
  inviteInfo: (token: string) => request<InviteInfo>("GET", `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ wikiKey: string; alreadyMember: boolean }>("POST", `/invites/${encodeURIComponent(token)}/accept`),

  listUsers: () => request<{ users: UserSummary[] }>("GET", "/admin/users"),
  setOwner: (userId: string, isOwner: boolean) => request<{ users: UserSummary[] }>("PUT", `/admin/users/${userId}/owner`, { isOwner }),

  listWikis: () => request<{ wikis: WikiSummary[]; baseDomain: string }>("GET", "/admin/wikis"),
  createWiki: (input: { key: string; name: string }) => request<WikiSummary>("POST", "/admin/wikis", input),
  updateWiki: (key: string, input: { name?: string; iconUrl?: string | null }) => request<WikiSummary>("PATCH", `/admin/wikis/${key}`, input),
  archiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/archive`),
  unarchiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/unarchive`),

  listPages: (q?: string) =>
    request<{ pages: PageSummary[] }>("GET", w(`/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`)),
  /** タイトルと本文の検索。語が無ければ、最近更新したページ */
  search: (q: string) => request<{ results: SearchResult[] }>("GET", w(`/search?q=${encodeURIComponent(q)}`)),
  createPage: (input: { title: string; bodyMd?: string; parentPageId?: string | null }) => request<PageDetail>("POST", w("/pages"), input),
  getPage: (id: string) => request<PageDetail>("GET", w(`/pages/${id}`)),
  savePage: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<PageDetail>("PUT", w(`/pages/${id}`), input),
  getDraft: (id: string) => request<{ draft: PageDraft | null }>("GET", w(`/pages/${id}/draft`)),
  saveDraft: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<{ draft: PageDraft | null }>("PUT", w(`/pages/${id}/draft`), input),
  discardDraft: (id: string) => request<{ draft: null }>("DELETE", w(`/pages/${id}/draft`)),
  /** 画像をアップロードし、本文に書くパス（`/images/{name}`）を返す。中身はそのまま送る */
  uploadImage: async (file: Blob): Promise<{ url: string }> => {
    const res = await fetch(`/api${w("/images")}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new ApiError(res.status, err.code ?? "error", err.message ?? res.statusText, err.details);
    }
    return data as { url: string };
  },
  deletePage: (id: string) => request<{ ok: true }>("DELETE", w(`/pages/${id}`)),
  listVersions: (id: string) => request<{ versions: VersionListItem[] }>("GET", w(`/pages/${id}/versions`)),
  getVersion: (id: string, versionId: string) => request<PageVersion>("GET", w(`/pages/${id}/versions/${versionId}`)),

  listStars: () => request<{ pageIds: string[] }>("GET", w("/stars")),
  addStar: (pageId: string) => request<{ pageIds: string[] }>("PUT", w(`/stars/${pageId}`)),
  removeStar: (pageId: string) => request<{ pageIds: string[] }>("DELETE", w(`/stars/${pageId}`)),
  reorderStars: (pageIds: string[]) => request<{ pageIds: string[] }>("PUT", w("/stars"), { pageIds }),

  setWorkflow: (id: string, input: SetWorkflowInput) => request<PageDetail>("POST", w(`/pages/${id}/workflow`), input),
  reviewDone: (id: string) => request<PageDetail>("POST", w(`/pages/${id}/review-done`)),

  publish: (id: string, input: { versionId: string; visibility: PublishVisibility; applyToDescendants?: boolean }) =>
    request<{ ok: true }>("POST", w(`/pages/${id}/publish`), input),
  unpublish: (id: string, input?: { applyToDescendants: boolean }) => request<{ ok: true }>("POST", w(`/pages/${id}/unpublish`), input),
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

  listMembers: () => request<{ members: Member[] }>("GET", w("/members")),
  changeRole: (userId: string, role: WikiRole) => request<{ members: Member[] }>("PATCH", w(`/members/${userId}`), { role }),
  removeMember: (userId: string) => request<{ ok: true }>("DELETE", w(`/members/${userId}`)),
  listInvites: () => request<{ invites: Invite[] }>("GET", w("/invites")),
  createInvite: (role: WikiRole) => request<{ token: string; invite: Invite }>("POST", w("/invites"), { role }),
  revokeInvite: (id: string) => request<{ ok: true }>("POST", w(`/invites/${id}/revoke`)),

  structure: () => request<StructureResponse>("GET", w("/structure")),
  commit: (input: { expectedHeadCommitId: string; message?: string; ops: StructureOpInput[] }) =>
    request<{ commitId: string }>("POST", w("/structure/commits"), input),
  history: () => request<{ commits: CommitListItem[] }>("GET", w("/structure/commits")),
  commitDetail: (id: string) =>
    request<{ commit: CommitListItem; changes: StructureChange[] }>("GET", w(`/structure/commits/${id}`)),
};

const VISIBILITY_LABEL = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "version_conflict":
        return "別の画面で先に版が作られています。最新の版を読み込んでから編集してください。";
      case "image_too_large":
        return `画像が大きすぎます。${IMAGE_LIMIT_LABEL}です。`;
      case "unsupported_image_type":
        return `この形式の画像はアップロードできません。${IMAGE_LIMIT_LABEL}です。`;
      case "images_not_configured":
        return "画像の置き場所が設定されていないため、アップロードできません。";
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
        return "この操作は、オーナーだけが行えます。";
      case "admin_only":
        return "この操作は、この wiki の管理者だけが行えます。";
      case "last_admin":
        return "管理者が1人もいなくなるため、できません。先にほかのメンバーを管理者にしてください。";
      case "last_owner":
        return "最後のオーナーは解除できません。先にほかの人をオーナーにしてください。";
      case "invite_used":
        return "この招待リンクは、すでに使われています。";
      case "invite_expired":
        return "この招待リンクは、期限が切れています。";
      case "invite_revoked":
        return "この招待リンクは、無効にされています。";
      case "invite_not_found":
        return "この招待リンクは見つかりません。";
      case "cycle":
        return "自分自身や子孫の下には移動できません。";
      case "exceeds_parent": {
        const d = err.details as { parentTitle?: string; parentVisibility?: keyof typeof VISIBILITY_LABEL } | undefined;
        const parent = d?.parentTitle ? `親ページ「${d.parentTitle}」` : "親ページ";
        const label = d?.parentVisibility ? VISIBILITY_LABEL[d.parentVisibility] : "より狭い公開範囲";
        return `${parent}が${label}のため、それより広い公開範囲にはできません。先に親ページを公開するか、このページの公開範囲を狭めてください。`;
      }
      case "descendants_wider": {
        const count = (err.details as { count?: number } | undefined)?.count;
        return `配下に、それより広い公開範囲のページが${count ? ` ${count} 件` : ""}あります。配下のページもまとめて変えるか、先に配下のページを狭めてください。`;
      }
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
