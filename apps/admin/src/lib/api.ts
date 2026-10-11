import type {
  AnalyticsDays,
  ConnectionCheck,
  GoogleConnection,
  AuditActorOption,
  AuditLogPage,
  Invite,
  InviteInfo,
  Me,
  Member,
  PageDetail,
  PageDraft,
  SavePageDraftResult,
  PageViews,
  PageTemplate,
  PageSummary,
  PageVersion,
  PageVersionList,
  PublishVisibility,
  SearchResult,
  ScheduledAction,
  OAuthConsentRequest,
  OAuthGrantSummary,
  StructureCommitDiff,
  StructureOpInput,
  TrashedPage,
  TreeMeta,
  TreeNode,
  UserSummary,
  UpdateAppearanceInput,
  UpdateHomeInput,
  WikiAnalytics,
  WikiAppearance,
  WikiHome,
  WikiRole,
  SnsPostResult,
  SnsStatus,
  WikiSettings,
  WikiSummary,
  WikiViews,
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
 * いま開いている wiki の key。wiki の内容を扱う API（ページ・ツリー・予約）は、すべてこの wiki の経路を呼ぶ。
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

/** 画像をアップロードする。本文はファイルの中身そのまま（multipart にしない） */
async function upload(path: string, file: Blob): Promise<{ url: string }> {
  const res = await fetch(`/api${path}`, {
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
}

/** via：外部のアプリ（MCP）から保存した版なら、そのアプリの名前 */
export type { PageVersionList, VersionListItem } from "@wiki/shared";

export type StructureTree = TreeMeta & { nodes: TreeNode[] };
export type StructureResponse = {
  headCommitId: string;
  trees: StructureTree[];
  pages: Record<
    string,
    {
      id: string;
      title: string;
      visibility: string;
      publishedVersionId: string | null;
      /** 限定公開の URL に入るキー。限定公開にしたことが無ければ null */
      unlistedKey: string | null;
      /** 最後に版を作った・公開の状態を変えた日時 */
      updatedAt: string;
    }
  >;
};

export type CommitListItem = {
  id: string;
  message: string | null;
  authorType: string;
  createdAt: string;
  parentIds: string[];
  /** 外部のアプリ（MCP）からの操作なら、そのアプリの名前 */
  via?: string | null;
  /** 構造を変えた人（いまの名前）。これより前のコミットと、人の操作でないものは null */
  createdBy?: { id: string; name: string } | null;
  /** 差分を出せるか。古いコミットは構造のスナップショットを消しているので false */
  diffAvailable: boolean;
};

/** 監査ログの絞り込み。from / to は JST の日付（YYYY-MM-DD）。wiki はオーナーの一覧だけ（"global" は全体にかかわるもの） */
export type AuditLogFilter = { from?: string; to?: string; actor?: string; category?: string; wiki?: string };

/** wiki：開いている wiki の監査ログ（管理者）／all：すべて（オーナー） */
export type AuditScope = "wiki" | "all";

const auditPath = (scope: AuditScope, path = "") => (scope === "wiki" ? w(`/audit-logs${path}`) : `/admin/audit-logs${path}`);

export const api = {
  providers: () => request<{ google: boolean; devLogin: boolean }>("GET", "/auth/providers"),
  devLogin: () => request<{ email: string }>("POST", "/auth/dev-login"),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  logoutOthers: () => request<{ ended: number }>("POST", "/auth/logout-others"),
  me: () => request<Me>("GET", "/admin/me"),

  // 招待リンクを開いた人向け（ログインしていなくても呼べる）
  // リンクの値は、アクセスログに残らないように本文で送る
  inviteInfo: (token: string) => request<InviteInfo>("POST", "/invites/inspect", { token }),
  acceptInvite: (token: string) => request<{ wikiKey: string; alreadyMember: boolean }>("POST", "/invites/accept", { token }),

  listUsers: () => request<{ users: UserSummary[] }>("GET", "/admin/users"),
  setOwner: (userId: string, isOwner: boolean) => request<{ users: UserSummary[] }>("PUT", `/admin/users/${userId}/owner`, { isOwner }),

  oauthRequest: (signed: string) =>
    request<OAuthConsentRequest>("GET", `/admin/oauth/request?${new URLSearchParams({ request: signed })}`),
  oauthDecide: (input: { request: string; approve: boolean; scopes: string[] }) =>
    request<{ redirectTo: string }>("POST", "/admin/oauth/request/decision", input),
  listGrants: () => request<{ grants: OAuthGrantSummary[] }>("GET", "/admin/oauth/grants"),
  revokeGrant: (id: string) => request<{ ok: true }>("POST", `/admin/oauth/grants/${id}/revoke`),

  listWikis: () => request<{ wikis: WikiSummary[]; baseDomain: string }>("GET", "/admin/wikis"),
  createWiki: (input: { key: string; name: string }) => request<WikiSummary>("POST", "/admin/wikis", input),
  updateWiki: (key: string, input: { name?: string; iconUrl?: string | null }) => request<WikiSummary>("PATCH", `/admin/wikis/${key}`, input),
  archiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/archive`),
  unarchiveWiki: (key: string) => request<WikiSummary>("POST", `/admin/wikis/${key}/unarchive`),

  listPages: (q?: string) =>
    request<{ pages: PageSummary[] }>("GET", w(`/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`)),
  /** ページの一覧を、続きから取る（「すべてのページ」の一覧）。`nextCursor` を次の呼び出しに渡す。無ければ、そこで終わり */
  listPagesPage: (input: { q?: string; cursor?: string | null; limit: number }) => {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.q) params.set("q", input.q);
    if (input.cursor) params.set("cursor", input.cursor);
    return request<{ pages: PageSummary[]; nextCursor: string | null }>("GET", w(`/pages?${params}`));
  },
  /** タイトルと本文の検索。語が無ければ、最近更新したページ */
  search: (q: string) => request<{ results: SearchResult[] }>("GET", w(`/search?q=${encodeURIComponent(q)}`)),
  /** templateId を渡すと、そのテンプレート（変数を置き換えたもの）で本文を始める。title を省くとテンプレートのタイトルになる */
  createPage: (input: { title?: string; bodyMd?: string; parentPageId?: string | null; templateId?: string }) =>
    request<PageDetail>("POST", w("/pages"), input),
  getPage: (id: string) => request<PageDetail>("GET", w(`/pages/${id}`)),
  savePage: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<PageDetail>("PUT", w(`/pages/${id}`), input),
  /** アイコン（絵文字1つ）を付ける・変える・外す（null）。版は作らず、すぐに反映される */
  setPageIcon: (id: string, icon: string | null) => request<PageDetail>("PUT", w(`/pages/${id}/icon`), { icon }),
  getDraft: (id: string) => request<{ draft: PageDraft | null }>("GET", w(`/pages/${id}/draft`)),
  saveDraft: (id: string, input: { baseVersionId: string; title: string; bodyMd: string }) =>
    request<SavePageDraftResult>("PUT", w(`/pages/${id}/draft`), input),
  discardDraft: (id: string) => request<{ draft: null }>("DELETE", w(`/pages/${id}/draft`)),
  /**
   * 画像をアップロードし、本文に書くパス（`/images/{name}`）を返す。中身はそのまま送る。
   * wiki の外の画面（wiki の管理）から使うときは、どの wiki の経路で送るかを key で渡す
   */
  uploadImage: (file: Blob, key: string = wikiKey) => upload(`/admin/w/${encodeURIComponent(key)}/images`, file),
  /** ゴミ箱に入れる（配下のページもいっしょに入る） */
  deletePage: (id: string) => request<{ ok: true; trashedPages: number }>("DELETE", w(`/pages/${id}`)),
  /** ゴミ箱の一覧。削除で選んだページごとに1行、新しい順 */
  listTrash: () => request<{ pages: TrashedPage[] }>("GET", w("/pages/trash")),
  /** ゴミ箱から、配下ごと元に戻す。parentMissing：元の親ページが無く、最上位に戻した */
  restorePage: (id: string) =>
    request<{ id: string; restoredPages: number; parentPageId: string | null; parentMissing: boolean }>("POST", w(`/pages/${id}/restore`)),
  /** ゴミ箱から、配下ごと完全に削除する（元に戻せない） */
  purgePage: (id: string) => request<{ ok: true; purgedPages: number }>("DELETE", w(`/pages/${id}/trash`)),
  /** 版履歴を、新しい順に続きから取る。`nextCursor` を次の呼び出しに渡す。無ければ、そこで終わり */
  listVersions: (id: string, input: { cursor?: string | null; limit: number }) => {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor) params.set("cursor", input.cursor);
    return request<PageVersionList>("GET", w(`/pages/${id}/versions?${params}`));
  },
  getVersion: (id: string, versionId: string) => request<PageVersion>("GET", w(`/pages/${id}/versions/${versionId}`)),

  /** wiki ごとの設定（Google Analytics の測定 ID・プロパティ ID、サーチコンソールの確認用の値）。変えられるのはオーナーだけ。null で外す */
  getSettings: () => request<WikiSettings>("GET", w("/settings")),
  updateSettings: (input: Partial<WikiSettings>) => request<WikiSettings>("PATCH", w("/settings"), input),

  /** 「設定」の「SNS」：wiki につないだ SNS のアカウント（管理者だけ） */
  snsStatus: () => request<SnsStatus>("GET", w("/sns")),
  /** X の認可を始める。返ってきた URL（X の認可の画面）へ移る */
  connectX: () => request<{ url: string }>("POST", w("/sns/x/connect")),
  disconnectX: () => request<SnsStatus>("POST", w("/sns/x/disconnect")),
  testPostX: (text: string) => request<SnsPostResult>("POST", w("/sns/x/test-post"), { text }),

  /** 「アクセス解析」：Google Analytics とサーチコンソールの数字と、連携の状態。同じ期間は、API が1時間のあいだ使い回す */
  analytics: (days: AnalyticsDays) => request<WikiAnalytics>("GET", w(`/analytics?days=${days}`)),
  /** Google から取り直す（1分おきまで） */
  refreshAnalytics: (days: AnalyticsDays) => request<WikiAnalytics>("POST", w("/analytics/refresh"), { days }),
  /** Google へ足すサービスアカウントのメールアドレスと、鍵の状態 */
  analyticsConnection: () => request<GoogleConnection>("GET", w("/analytics/connection")),
  /** 「接続を確かめる」：保存してある設定で、Google へ問い合わせてみる */
  checkAnalytics: (target: "ga" | "search_console") => request<ConnectionCheck>("POST", w("/analytics/check"), { target }),

  /** 閲覧数（ページごとの合計・直近30日） */
  listViews: () => request<WikiViews>("GET", w("/views")),
  /** 1ページの閲覧数（直近30日の日別を含む） */
  pageViews: (id: string) => request<PageViews>("GET", w(`/views/pages/${id}`)),

  listStars: () => request<{ pageIds: string[] }>("GET", w("/stars")),
  addStar: (pageId: string) => request<{ pageIds: string[] }>("PUT", w(`/stars/${pageId}`)),
  removeStar: (pageId: string) => request<{ pageIds: string[] }>("DELETE", w(`/stars/${pageId}`)),
  reorderStars: (pageIds: string[]) => request<{ pageIds: string[] }>("PUT", w("/stars"), { pageIds }),


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


  listTemplates: () => request<{ templates: PageTemplate[] }>("GET", w("/templates")),
  getTemplate: (id: string) => request<PageTemplate>("GET", w(`/templates/${id}`)),
  createTemplate: (input: { title: string; bodyMd: string }) => request<PageTemplate>("POST", w("/templates"), input),
  updateTemplate: (id: string, input: { title: string; bodyMd: string }) => request<PageTemplate>("PUT", w(`/templates/${id}`), input),
  deleteTemplate: (id: string) => request<{ ok: true }>("DELETE", w(`/templates/${id}`)),
  /** 変数を置き換えたタイトルと本文 */
  renderTemplate: (id: string) => request<{ title: string; bodyMd: string }>("GET", w(`/templates/${id}/render`)),
  listMembers: () => request<{ members: Member[] }>("GET", w("/members")),
  changeRole: (userId: string, role: WikiRole) => request<{ members: Member[] }>("PATCH", w(`/members/${userId}`), { role }),
  removeMember: (userId: string) => request<{ ok: true }>("DELETE", w(`/members/${userId}`)),
  listInvites: () => request<{ invites: Invite[] }>("GET", w("/invites")),
  createInvite: (role: WikiRole) => request<{ token: string; invite: Invite }>("POST", w("/invites"), { role }),
  revokeInvite: (id: string) => request<{ ok: true }>("POST", w(`/invites/${id}/revoke`)),

  listAuditLogs: (scope: AuditScope, filter: AuditLogFilter, cursor?: string) => {
    const q = new URLSearchParams(Object.entries({ ...filter, cursor }).filter(([, v]) => v) as [string, string][]);
    return request<AuditLogPage>("GET", auditPath(scope, q.size ? `?${q}` : ""));
  },
  listAuditActors: (scope: AuditScope) => request<{ actors: AuditActorOption[] }>("GET", auditPath(scope, "/actors")),
  /** 公開サイトの「外観」（管理者だけ） */
  getAppearance: () => request<WikiAppearance>("GET", w("/appearance")),
  saveAppearance: (input: UpdateAppearanceInput) => request<WikiAppearance>("PUT", w("/appearance"), input),
  getHome: () => request<WikiHome>("GET", w("/home")),
  saveHome: (input: UpdateHomeInput) => request<WikiHome>("PUT", w("/home"), input),
  /** ロゴ・ファビコンをアップロードし、パス（`/images/{name}`）を返す。PNG・WebP の 512KB まで */
  uploadThemeImage: (file: Blob) => upload(w("/appearance/images"), file),

  structure: () => request<StructureResponse>("GET", w("/structure")),
  commit: (input: { expectedHeadCommitId: string; message?: string; ops: StructureOpInput[] }) =>
    request<{ commitId: string }>("POST", w("/structure/commits"), input),
  history: () => request<{ commits: CommitListItem[] }>("GET", w("/structure/commits")),
  commitDetail: (id: string) =>
    request<{ commit: CommitListItem } & StructureCommitDiff>("GET", w(`/structure/commits/${id}`)),
};

const VISIBILITY_LABEL = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;

/** 画像の条件。ロゴ・ファビコンは本文の画像より狭いので、API が返した条件があればそれを出す */
function imageLimit(err: ApiError): string {
  const limit = (err.details as { limit?: unknown } | undefined)?.limit;
  return typeof limit === "string" ? limit : IMAGE_LIMIT_LABEL;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "version_conflict":
        return "別の画面で先に版が作られています。最新の版を読み込んでから編集してください。";
      case "image_too_large":
        return `画像が大きすぎます。${imageLimit(err)}です。`;
      case "unsupported_image_type":
        return `この形式の画像はアップロードできません。${imageLimit(err)}です。`;
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
      case "x_not_configured":
        return "この管理画面には、X の開発者アプリの設定がまだ登録されていないため、X と連携できません。";
      case "sns_not_connected":
        return "この wiki には、X のアカウントが連携されていません。先に「X と連携する」から連携してください。";
      case "x_reauth_required":
        return "X との連携が切れています（X の側で連携を外したか、許可の期限が切れました）。「X と連携し直す」から、もう一度許可してください。";
      case "x_rejected": {
        const detail = (err.details as { detail?: unknown } | undefined)?.detail;
        const reason = typeof detail === "string" && detail ? `（X からの説明：${detail}）` : "";
        return `X がこのポストを受け付けませんでした${reason}。同じ文面を続けてポストすると断られます。文面を変えて、もう一度お試しください。`;
      }
      case "x_rate_limited":
        return "X のポストの回数の上限に達しました。時間をおいて、もう一度お試しください。";
      case "x_unavailable":
        return "X に届きませんでした。時間をおいて、もう一度お試しください。";
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
