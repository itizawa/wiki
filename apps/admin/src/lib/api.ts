import type {
  AcceptEditRequestResult,
  AnalyticsDays,
  CostsReport,
  AppliedEditRequests,
  CreatedEditRequest,
  CreateEditRequestInput,
  EditRequestComment,
  EditRequestCount,
  EditRequestList,
  EditRequestListStatus,
  EditRequestPageCount,
  PageEditRequests,
  ConnectionCheck,
  GoogleConnection,
  AuditActorOption,
  AuditLogPage,
  Invite,
  InviteInfo,
  LinkPreview,
  Me,
  Member,
  PageDetail,
  PageDraft,
  SavePageDraftResult,
  PageTemplate,
  PageSummary,
  PageVersion,
  PageVersionList,
  PublishVisibility,
  SearchResult,
  ScheduledAction,
  OAuthConsentRequest,
  OAuthGrantSummary,
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
  CreateRoutineInput,
  RoutineList,
  RoutineSummary,
  RoutineTestResult,
  SnsPostResult,
  UpdateRoutineInput,
  SnsStatus,
  PageTagList,
  TagList,
  WikiSettings,
  WikiTag,
  WikiSummary,
} from "@wiki/shared";
import { IMAGE_LIMIT_LABEL, PAGE_TITLE_MAX } from "@wiki/shared";

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

/** エラー応答（`{ error: { code, message, details } }`）から ApiError を作る。本文が読めなかった（null）ときは statusText を使う */
function apiError(res: Response, data: any): ApiError {
  const err = data?.error ?? {};
  return new ApiError(res.status, err.code ?? "error", err.message ?? res.statusText, err.details);
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
    throw apiError(res, data);
  }
  return data as T;
}

/** クエリ文字列を作る。空の値（`""`・`0`・null・undefined）は付けない。先頭の `?` 付きで返し、付ける値が無ければ `""` */
function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return q.size ? `?${q}` : "";
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
    throw apiError(res, data);
  }
  return data as { url: string };
}

/** via：外部のアプリ（MCP）から保存した版なら、そのアプリの名前 */
export type { PageVersionList, VersionListItem } from "@wiki/shared";

export type StructureTree = TreeMeta & { nodes: TreeNode[] };
export type StructureResponse = {
  trees: StructureTree[];
  pages: Record<
    string,
    {
      id: string;
      title: string;
      /** 設定した絵文字。無ければ null */
      icon: string | null;
      visibility: string;
      publishedVersionId: string | null;
      /** 限定公開の URL に入るキー。限定公開にしたことが無ければ null */
      unlistedKey: string | null;
      /** 最後に版を作った・公開の状態を変えた日時 */
      updatedAt: string;
    }
  >;
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

  /** 「コスト」：サービスごとの今月・前月の使用量（オーナーだけ） */
  costs: () => request<CostsReport>("GET", "/admin/costs"),

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
  listPagesPage: (input: { q?: string; cursor?: string | null; limit: number; unpublished?: boolean }) => {
    return request<{ pages: PageSummary[]; nextCursor: string | null }>(
      "GET",
      w(`/pages${query({ limit: String(input.limit), q: input.q, cursor: input.cursor, published: input.unpublished ? "false" : undefined })}`),
    );
  },
  /** 外部の URL の OGP（API が代わりに取る）。取れなければ `preview: null`。取りにいけない URL（http・内部 IP など）は 400 */
  linkPreview: (url: string) => request<{ preview: LinkPreview | null }>("GET", w(`/link-preview?url=${encodeURIComponent(url)}`)),
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
  /** カバー画像（`/images/{name}` か用意した画像）を付ける・変える・外す（null）。版は作らず、すぐに反映される */
  setPageCover: (id: string, cover: string | null) => request<PageDetail>("PUT", w(`/pages/${id}/cover`), { cover }),
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
    return request<PageVersionList>("GET", w(`/pages/${id}/versions${query({ limit: String(input.limit), cursor: input.cursor })}`));
  },
  getVersion: (id: string, versionId: string) => request<PageVersion>("GET", w(`/pages/${id}/versions/${versionId}`)),

  /** ページの編集リクエスト（新しい順）と、最新の版の本文。項目には、最新の版での行の範囲と、採用できるかが付く */
  listEditRequests: (pageId: string) => request<PageEditRequests>("GET", w(`/pages/${pageId}/edit-requests`)),
  /** ページの、未対応の項目の数 */
  countEditRequests: (pageId: string) => request<EditRequestCount>("GET", w(`/pages/${pageId}/edit-requests/count`)),
  /** `since` の版のあとに、採用でかかった置き換え（編集画面が、手元の内容に取り込む） */
  appliedEditRequests: (pageId: string, since: string) =>
    request<AppliedEditRequests>("GET", w(`/pages/${pageId}/edit-requests/applied?since=${encodeURIComponent(since)}`)),
  /** 項目を1件採用する。古くなった・編集中の人の下書きとぶつかる・もう未対応でないときは 409 */
  acceptEditRequestItem: (pageId: string, itemId: string) =>
    request<AcceptEditRequestResult>("POST", w(`/pages/${pageId}/edit-request-items/${itemId}/accept`)),
  rejectEditRequestItem: (pageId: string, itemId: string) => request<{ ok: true }>("POST", w(`/pages/${pageId}/edit-request-items/${itemId}/reject`)),
  /** 指摘を解決済みにする（古くなった指摘も）。提案は 409（`not_a_note`） */
  resolveEditRequestItem: (pageId: string, itemId: string) => request<{ ok: true }>("POST", w(`/pages/${pageId}/edit-request-items/${itemId}/resolve`)),
  /** 項目に返信する（プレーンテキスト）。項目の状態は問わない */
  replyToEditRequestItem: (pageId: string, itemId: string, body: string) =>
    request<EditRequestComment>("POST", w(`/pages/${pageId}/edit-request-items/${itemId}/comments`), { body }),
  /** 却下した提案・解決済みにした指摘を、未対応に戻す */
  reopenEditRequestItem: (pageId: string, itemId: string) => request<{ ok: true }>("POST", w(`/pages/${pageId}/edit-request-items/${itemId}/reopen`)),
  /** リクエストの未対応の項目のうち、採用できるものをまとめて採用する（1つの版になる）。できなかった項目は `skipped` で返る */
  acceptAllEditRequestItems: (pageId: string, requestId: string) =>
    request<AcceptEditRequestResult>("POST", w(`/pages/${pageId}/edit-requests/${requestId}/accept-all`)),
  /** 編集リクエストを出す。基準の版が最新の版でなければ 409（`version_conflict`） */
  createEditRequest: (pageId: string, input: CreateEditRequestInput) => request<CreatedEditRequest>("POST", w(`/pages/${pageId}/edit-requests`), input),
  /** 自分が出したリクエストの、未対応の項目をまとめて取り下げる。出した本人でなければ 403（`not_requester`） */
  withdrawEditRequest: (pageId: string, requestId: string) =>
    request<{ withdrawn: number }>("POST", w(`/pages/${pageId}/edit-requests/${requestId}/withdraw`)),
  /** この wiki の編集リクエストの一覧を、続きから取る（出した日時の新しい順）。`nextCursor` を次の呼び出しに渡す。無ければ、そこで終わり */
  listWikiEditRequests: (input: { status: EditRequestListStatus; cursor?: string | null; limit: number }) => {
    return request<EditRequestList>("GET", w(`/edit-requests${query({ status: input.status, limit: String(input.limit), cursor: input.cursor })}`));
  },
  /** この wiki で、未対応の編集リクエストがあるページの数（サイドバーに出す） */
  countEditRequestPages: () => request<EditRequestPageCount>("GET", w("/edit-requests/count")),

  /** wiki ごとの設定（Google Analytics の測定 ID・プロパティ ID、サーチコンソールの確認用の値）。変えられるのはオーナーだけ。null で外す */
  getSettings: () => request<WikiSettings>("GET", w("/settings")),
  updateSettings: (input: Partial<WikiSettings> & { sitePublic?: boolean }) => request<WikiSettings>("PATCH", w("/settings"), input),

  /** 「設定」の「SNS」：wiki につないだ SNS のアカウント（管理者だけ） */
  snsStatus: () => request<SnsStatus>("GET", w("/sns")),
  /** X の認可を始める。返ってきた URL（X の認可の画面）へ移る */
  connectX: () => request<{ url: string }>("POST", w("/sns/x/connect")),
  disconnectX: () => request<SnsStatus>("POST", w("/sns/x/disconnect")),
  testPostX: (text: string) => request<SnsPostResult>("POST", w("/sns/x/test-post"), { text }),

  /** 「全体の管理」の「Routine」：ワークフローが呼ぶ Claude Routine の登録（オーナーだけ）。トークンは返ってこない */
  listRoutines: () => request<RoutineList>("GET", "/admin/routines"),
  createRoutine: (input: CreateRoutineInput) => request<RoutineSummary>("POST", "/admin/routines", input),
  /** token は入れたときだけ置き換わる */
  updateRoutine: (id: string, input: UpdateRoutineInput) => request<RoutineSummary>("PATCH", `/admin/routines/${id}`, input),
  deleteRoutine: (id: string) => request<null>("DELETE", `/admin/routines/${id}`),
  /** 決まりの文で1回呼ぶ（Routine の回数を1回使う）。呼べなかったときも、理由が結果に入って返る */
  testRoutine: (id: string) => request<RoutineTestResult>("POST", `/admin/routines/${id}/test`),

  /** 「アクセス解析」：Google Analytics とサーチコンソールの数字と、連携の状態。同じ期間は、API が1時間のあいだ使い回す */
  analytics: (days: AnalyticsDays) => request<WikiAnalytics>("GET", w(`/analytics?days=${days}`)),
  /** Google から取り直す（1分おきまで） */
  refreshAnalytics: (days: AnalyticsDays) => request<WikiAnalytics>("POST", w("/analytics/refresh"), { days }),
  /** Google へ足すサービスアカウントのメールアドレスと、鍵の状態 */
  analyticsConnection: () => request<GoogleConnection>("GET", w("/analytics/connection")),
  /** 「接続を確かめる」：保存してある設定で、Google へ問い合わせてみる */
  checkAnalytics: (target: "ga" | "search_console") => request<ConnectionCheck>("POST", w("/analytics/check"), { target }),

  listStars: () => request<{ pageIds: string[] }>("GET", w("/stars")),
  addStar: (pageId: string) => request<{ pageIds: string[] }>("PUT", w(`/stars/${pageId}`)),
  removeStar: (pageId: string) => request<{ pageIds: string[] }>("DELETE", w(`/stars/${pageId}`)),
  reorderStars: (pageIds: string[]) => request<{ pageIds: string[] }>("PUT", w("/stars"), { pageIds }),


  publish: (id: string, input: { versionId: string; visibility: PublishVisibility; applyToDescendants?: boolean }) =>
    request<{ ok: true }>("POST", w(`/pages/${id}/publish`), input),
  unpublish: (id: string, input?: { applyToDescendants: boolean }) => request<{ ok: true }>("POST", w(`/pages/${id}/unpublish`), input),
  rotateUnlistedKey: (id: string) => request<{ unlistedKey: string }>("POST", w(`/pages/${id}/unlisted-key`)),

  listSchedule: (params: { from?: string; to?: string; pageId?: string; status?: string } = {}) => {
    return request<{ actions: ScheduledAction[] }>("GET", w(`/schedule${query(params)}`));
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
    return request<AuditLogPage>("GET", auditPath(scope, query({ ...filter, cursor })));
  },
  listAuditActors: (scope: AuditScope) => request<{ actors: AuditActorOption[] }>("GET", auditPath(scope, "/actors")),
  /** 公開サイトの「外観」（管理者だけ） */
  getAppearance: () => request<WikiAppearance>("GET", w("/appearance")),
  saveAppearance: (input: UpdateAppearanceInput) => request<WikiAppearance>("PUT", w("/appearance"), input),
  getHome: () => request<WikiHome>("GET", w("/home")),
  saveHome: (input: UpdateHomeInput) => request<WikiHome>("PUT", w("/home"), input),
  /** ロゴ・ファビコンをアップロードし、パス（`/images/{name}`）を返す。PNG・WebP の 512KB まで */
  uploadThemeImage: (file: Blob) => upload(w("/appearance/images"), file),
  /** 背景画像をアップロードし、パス（`/images/{name}`）を返す。PNG・JPEG・WebP の 2MB まで */
  uploadBackgroundImage: (file: Blob) => upload(w("/appearance/background-images"), file),

  /** 管理用タグ。一覧は wiki のメンバーなら読める。作る・名前を変える・消すのは管理者だけ */
  listTags: () => request<TagList>("GET", w("/tags")),
  createTag: (name: string) => request<WikiTag>("POST", w("/tags"), { name }),
  renameTag: (id: string, name: string) => request<WikiTag>("PATCH", w(`/tags/${id}`), { name }),
  deleteTag: (id: string) => request<null>("DELETE", w(`/tags/${id}`)),
  /** ページへのタグの付け外し（編集者以上）。すでにそうなっていても成功し、そのページのいまのタグを返す */
  attachTag: (pageId: string, tagId: string) => request<PageTagList>("PUT", w(`/pages/${pageId}/tags/${tagId}`)),
  detachTag: (pageId: string, tagId: string) => request<PageTagList>("DELETE", w(`/pages/${pageId}/tags/${tagId}`)),

  structure: () => request<StructureResponse>("GET", w("/structure")),
  changeStructure: (input: { ops: StructureOpInput[] }) => request<void>("POST", w("/structure/ops"), input),
};

const VISIBILITY_LABEL = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;

/** 画像の条件。ロゴ・ファビコンは本文の画像より狭いので、API が返した条件があればそれを出す */
function imageLimit(err: ApiError): string {
  const limit = (err.details as { limit?: unknown } | undefined)?.limit;
  return typeof limit === "string" ? limit : IMAGE_LIMIT_LABEL;
}

/** API の検証エラー（zod の項目）に出てくる項目名 */
const FIELD_LABEL: Record<string, string> = { title: "タイトル", bodyMd: "本文" };

/** `invalid_input` の `details`（zod の項目の配列）から、どの項目をどう直すかを言う。分からなければ、確かめるよう促す */
export function invalidInputMessage(details: unknown): string {
  const issues = Array.isArray(details) ? (details as { path?: unknown; code?: string }[]) : [];
  const first = issues.find((i) => Array.isArray(i.path) && typeof i.path[0] === "string" && FIELD_LABEL[i.path[0]]);
  const field = first && Array.isArray(first.path) ? (first.path[0] as string) : null;
  if (field === "title") {
    return first?.code === "too_small" ? "タイトルを入れてください。" : `タイトルは${PAGE_TITLE_MAX}字までです。短くしてください。`;
  }
  if (field) return `${FIELD_LABEL[field]}の内容に誤りがあります。確かめて、もう一度お試しください。`;
  return "入力内容に誤りがあります。各項目を確かめて、もう一度お試しください。";
}

/** `details` を使わず、`code` だけで決まる文言 */
const MESSAGES: Record<string, string> = {
  not_found: "見つかりません。ゴミ箱に入れられたか、URL が違います。",
  invalid_request: "接続の依頼が見つからないか、期限が切れています。",
  version_conflict: "別の画面で先に版が作られています。最新の版を読み込んでから編集してください。",
  edit_request_stale: "この箇所は、提案のあとに書き換えられたため、採用できません。",
  not_open: "この提案は、すでに採用・却下・取り下げのどれかが済んでいます。最新の状態を読み込みました。",
  not_requester: "取り下げられるのは、このリクエストを出した本人だけです。",
  no_change: "元の文面と同じ提案が入っています。書き換えるか、取り除いてから送信してください。",
  line_out_of_range: "提案の指している行が、本文の外にあります。最新の版に合わせてから、もう一度送信してください。",
  not_rejected: "却下した提案だけを、未対応に戻せます。最新の状態を読み込みました。",
  images_not_configured: "画像の置き場所が設定されていないため、アップロードできません。",
  has_children: "子があるため外せません。先に子を移動してください。",
  run_at_in_past: "過去の日時は指定できません。",
  not_scheduled: "実行中または実行済みのため変更できません。",
  wiki_key_taken: "この key はすでに使われています（アーカイブ中の wiki を含みます）。別の key を入力してください。",
  wiki_not_found: "この wiki は見つかりません。アーカイブされたか、URL が違います。",
  owner_only: "この操作は、オーナーだけが行えます。",
  admin_only: "この操作は、この wiki の管理者だけが行えます。",
  last_admin: "管理者が1人もいなくなるため、できません。先にほかのメンバーを管理者にしてください。",
  last_owner: "最後のオーナーは解除できません。先にほかの人をオーナーにしてください。",
  invite_used: "この招待リンクは、すでに使われています。",
  invite_expired: "この招待リンクは、期限が切れています。",
  invite_revoked: "この招待リンクは、無効にされています。",
  invite_not_found: "この招待リンクは見つかりません。",
  cycle: "自分自身や子孫の下には移動できません。",
  x_not_configured: "この管理画面には、X の開発者アプリの設定がまだ登録されていないため、X と連携できません。",
  sns_not_connected: "この wiki には、X のアカウントが連携されていません。先に「X と連携する」から連携してください。",
  x_reauth_required: "X との連携が切れています（X の側で連携を外したか、許可の期限が切れました）。「X と連携し直す」から、もう一度許可してください。",
  x_rate_limited: "X のポストの回数の上限に達しました。時間をおいて、もう一度お試しください。",
  x_payment_required: "X の API の利用残高が足りません。X の開発者ポータルでクレジットを購入してから、もう一度お試しください。",
  tag_exists: "この名前のタグは、すでにあります。別の名前にしてください（大文字と小文字は区別されます）。",
  routine_not_configured: "この管理画面には、Routine のトークンを暗号化する鍵（ROUTINE_TOKEN_KEY）がまだ登録されていないため、Routine を登録・実行できません。",
  routine_exists: "この名前の Routine は、すでに登録されています。別の名前にしてください。",
  routine_token_unreadable: "登録してあるトークンを読み出せません（暗号化の鍵が変わった可能性があります）。「編集」からトークンを入れ直してください。",
  x_unavailable: "X に届きませんでした。時間をおいて、もう一度お試しください。",
};

/** `details` を使って文言を組み立てる `code` */
const DETAIL_MESSAGES: Record<string, (err: ApiError) => string> = {
  invalid_input: (err) => invalidInputMessage(err.details),
  draft_conflict: (err) => {
    const editors = (err.details as { editors?: { name: string }[] } | undefined)?.editors ?? [];
    const who = editors.length > 0 ? `${editors.map((e) => e.name).join("、")} さん` : "ほかの人";
    return `${who}がこの箇所を編集中のため、採用できません。編集が版になるのを待つか、本人に確かめてください。`;
  },
  image_too_large: (err) => `画像が大きすぎます。${imageLimit(err)}です。`,
  unsupported_image_type: (err) => `この形式の画像はアップロードできません。${imageLimit(err)}です。`,
  x_rejected: (err) => {
    const detail = (err.details as { detail?: unknown } | undefined)?.detail;
    const reason = typeof detail === "string" && detail ? `（X からの説明：${detail}）` : "";
    return `X がこのポストを受け付けませんでした${reason}。同じ文面を続けてポストすると断られます。文面を変えて、もう一度お試しください。`;
  },
  exceeds_parent: (err) => {
    const d = err.details as { parentTitle?: string; parentVisibility?: keyof typeof VISIBILITY_LABEL } | undefined;
    const parent = d?.parentTitle ? `親ページ「${d.parentTitle}」` : "親ページ";
    const label = d?.parentVisibility ? VISIBILITY_LABEL[d.parentVisibility] : "より狭い公開範囲";
    return `${parent}が${label}のため、それより広い公開範囲にはできません。先に親ページを公開するか、このページの公開範囲を狭めてください。`;
  },
  descendants_wider: (err) => {
    const count = (err.details as { count?: number } | undefined)?.count;
    return `配下に、それより広い公開範囲のページが${count ? ` ${count} 件` : ""}あります。配下のページもまとめて変えるか、先に配下のページを狭めてください。`;
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fixed = Object.hasOwn(MESSAGES, err.code) ? MESSAGES[err.code] : undefined;
    if (fixed !== undefined) return fixed;
    const detailed = Object.hasOwn(DETAIL_MESSAGES, err.code) ? DETAIL_MESSAGES[err.code] : undefined;
    return detailed ? detailed(err) : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
