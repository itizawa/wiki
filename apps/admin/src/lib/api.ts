import type {
  PageDetail,
  PageSummary,
  PageVersion,
  PublishVisibility,
  ScheduledAction,
  StructureChange,
  StructureOpInput,
  TreeMeta,
  TreeNode,
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
  me: () => request<{ email: string }>("GET", "/admin/me"),
  settings: () => request<{ siteOrigin: string }>("GET", "/admin/settings"),

  listPages: (q?: string) =>
    request<{ pages: PageSummary[] }>("GET", `/admin/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createPage: (input: { title: string; bodyMd?: string; parentPageId?: string | null }) => request<PageDetail>("POST", "/admin/pages", input),
  getPage: (id: string) => request<PageDetail>("GET", `/admin/pages/${id}`),
  savePage: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<PageDetail>("PUT", `/admin/pages/${id}`, input),
  deletePage: (id: string) => request<{ ok: true }>("DELETE", `/admin/pages/${id}`),
  listVersions: (id: string) => request<{ versions: VersionListItem[] }>("GET", `/admin/pages/${id}/versions`),
  getVersion: (id: string, versionId: string) => request<PageVersion>("GET", `/admin/pages/${id}/versions/${versionId}`),

  publish: (id: string, input: { versionId: string; visibility: PublishVisibility }) =>
    request<{ ok: true }>("POST", `/admin/pages/${id}/publish`, input),
  unpublish: (id: string) => request<{ ok: true }>("POST", `/admin/pages/${id}/unpublish`),
  rotateUnlistedKey: (id: string) => request<{ unlistedKey: string }>("POST", `/admin/pages/${id}/unlisted-key`),

  listSchedule: (params: { from?: string; to?: string; pageId?: string; status?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return request<{ actions: ScheduledAction[] }>("GET", `/admin/schedule${q.size ? `?${q}` : ""}`);
  },
  createSchedule: (
    input:
      | { actionType: "publish_page"; pageId: string; versionId: string; targetVisibility: PublishVisibility; runAt: string; batchId?: string }
      | { actionType: "unpublish_page"; pageId: string; runAt: string; batchId?: string },
  ) => request<ScheduledAction>("POST", "/admin/schedule", input),
  reschedule: (id: string, runAt: string) => request<ScheduledAction>("PATCH", `/admin/schedule/${id}`, { runAt }),
  cancelSchedule: (id: string) => request<ScheduledAction>("POST", `/admin/schedule/${id}/cancel`),

  structure: () => request<StructureResponse>("GET", "/admin/structure"),
  commit: (input: { expectedHeadCommitId: string; message?: string; ops: StructureOpInput[] }) =>
    request<{ commitId: string }>("POST", "/admin/structure/commits", input),
  history: () => request<{ commits: CommitListItem[] }>("GET", "/admin/structure/commits"),
  commitDetail: (id: string) =>
    request<{ commit: CommitListItem; changes: StructureChange[] }>("GET", `/admin/structure/commits/${id}`),
  updateTree: (id: string, input: { name?: string; isPublic?: boolean }) =>
    request<TreeMeta>("PATCH", `/admin/trees/${id}`, input),
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
      case "cycle":
        return "自分自身や子孫の下には移動できません。";
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
