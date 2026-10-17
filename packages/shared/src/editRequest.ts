import { z } from "zod";

/**
 * 編集リクエスト：ページの本文に、箇所ごとの「こう直す」を出し、人が1件ずつ採否を決める。
 *
 * - **リクエスト**は1ページに対する1回分。全体へのひとこと（任意）を持ち、箇所ごとの**項目**を束ねる
 * - 項目の位置は「基準の版の ID・本文（Markdown）の行の範囲・その範囲の元の文面」で持つ
 * - 採用すると、最新の版の該当行を置き換えて新しい版を作る。最新の版が基準の版から進んでいたら、元の文面で場所を探し直す
 *
 * 行の数え方（`bodyLines`）と置き換え（`applyLineEdits`）は、API・MCP・管理画面のどれもここのものを使う。
 * 別々に数えると、提案が1行ずれた場所にかかる。
 */

// ---------------------------------------------------------------------------
// 行の数え方
// ---------------------------------------------------------------------------

/**
 * 本文（`body_md`）を行に分ける。**行の数え方は、これ1つだけ**。
 *
 * - 改行（`\n`）で区切る。行は1から数える（`bodyLines(body)[0]` が1行目）
 * - 空行も1行。表の行・コードブロックの中の行も、そのまま1行
 * - 末尾が改行で終わる本文は、最後に空の行が1つあるものとして数える（`"a\n"` は2行）
 * - CRLF はそろえない。`\r` は、その行の文字として残る（そろえると、触っていない行まで変わる）
 * - 空の本文は、空の行が1つ
 *
 * `bodyLines(body).join("\n") === body` が必ず成り立つ。
 * 版履歴の差分は、先頭に `# タイトル` と空行を足したものを比べているので、ここの行番号より2つ大きい。
 */
export function bodyLines(body: string): string[] {
  return body.split("\n");
}

/** 置き換え案を行に分ける。空の文字は「その行を消す」（0行）。 */
export function replacementLines(replacement: string): string[] {
  return replacement === "" ? [] : bodyLines(replacement);
}

/** 本文の `startLine`〜`endLine` 行目（両端を含む）。範囲が本文の外なら null。 */
export function sliceLines(body: string, startLine: number, endLine: number): string | null {
  const lines = bodyLines(body);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return null;
  return lines.slice(startLine - 1, endLine).join("\n");
}

// ---------------------------------------------------------------------------
// 行の置き換え
// ---------------------------------------------------------------------------

/** 行の範囲への置き換え1件。 */
export type LineEdit = {
  id: string;
  /** 基準の版での行の範囲（1から数え、両端を含む） */
  startLine: number;
  endLine: number;
  /** 基準の版で、その範囲にあった文面 */
  originalText: string;
  /** 置き換える文面。空の文字なら、その行を消す */
  replacement: string;
  /** かける先の本文が、基準の版の本文そのものか。true なら行の範囲をそのまま使い、false なら元の文面で場所を探し直す */
  atBase: boolean;
};

/**
 * 「古くなった」の理由。
 * - not_found: 元の文面が、もう本文に無い（その箇所が書き換えられた）
 * - ambiguous: 元の文面が本文に複数あり、どれを指していたか決められない
 */
export type StaleReason = "not_found" | "ambiguous";

export type LocateResult = { ok: true; startLine: number; endLine: number } | { ok: false; reason: StaleReason };

const sameLines = (lines: readonly string[], at: number, want: readonly string[]) => {
  for (let i = 0; i < want.length; i++) if (lines[at + i] !== want[i]) return false;
  return true;
};

function locateIn(lines: readonly string[], edit: Pick<LineEdit, "startLine" | "endLine" | "originalText" | "atBase">): LocateResult {
  const want = bodyLines(edit.originalText);
  // 基準の版と同じ本文なら、行の範囲をそのまま使う（同じ文面がほかにあっても迷わない）
  if (edit.atBase && edit.endLine <= lines.length && edit.endLine - edit.startLine + 1 === want.length && sameLines(lines, edit.startLine - 1, want)) {
    return { ok: true, startLine: edit.startLine, endLine: edit.endLine };
  }
  // 本文が進んでいたら、元の文面を行のまとまりとして探し直す。1か所だけなら、そこ
  let found = -1;
  for (let at = 0; at + want.length <= lines.length; at++) {
    if (!sameLines(lines, at, want)) continue;
    if (found >= 0) return { ok: false, reason: "ambiguous" };
    found = at;
  }
  if (found < 0) return { ok: false, reason: "not_found" };
  return { ok: true, startLine: found + 1, endLine: found + want.length };
}

/**
 * 置き換えをかける場所を、いまの本文の中で決める。決められなければ「古くなった」（`ok: false`）。
 * 返す行の範囲は、渡した本文でのもの。
 */
export function locateLineEdit(body: string, edit: Pick<LineEdit, "startLine" | "endLine" | "originalText" | "atBase">): LocateResult {
  return locateIn(bodyLines(body), edit);
}

export type AppliedLineEdit = {
  id: string;
  /**
   * 置き換えたあとの本文での、置き換え案の行の範囲。
   * 行を消した置き換え（置き換え案が空）では、`endLine` が `startLine - 1` になる（`startLine` は、消した場所の次の行）
   */
  startLine: number;
  endLine: number;
};

/** かけられなかった置き換え。overlap は、先にかけた置き換えと行が重なったもの */
export type SkippedLineEdit = { id: string; reason: StaleReason | "overlap" };

export type ApplyLineEditsResult = { body: string; applied: AppliedLineEdit[]; skipped: SkippedLineEdit[] };

/**
 * 本文に、行の範囲への置き換えをまとめてかける（純粋な関数。本文は書き換えず、新しい本文を返す）。
 *
 * - 場所は、どの置き換えも**渡した本文**の中で決めてから、下の行から順にかける。なので、まとめてかけても行はずれない
 * - 場所を決められない置き換え（古くなったもの）と、先に並んだ置き換えと行が重なるものは、かけずに `skipped` に入れる
 * - `applied` と `skipped` は、渡した順
 */
export function applyLineEdits(body: string, edits: readonly LineEdit[]): ApplyLineEditsResult {
  const lines = bodyLines(body);
  const skipped: SkippedLineEdit[] = [];
  const located: { edit: LineEdit; startLine: number; endLine: number }[] = [];
  for (const edit of edits) {
    const at = locateIn(lines, edit);
    if (!at.ok) skipped.push({ id: edit.id, reason: at.reason });
    else if (located.some((l) => at.startLine <= l.endLine && l.startLine <= at.endLine)) skipped.push({ id: edit.id, reason: "overlap" });
    else located.push({ edit, startLine: at.startLine, endLine: at.endLine });
  }

  // 下の行から置き換える（上の行の番号が変わらない）
  const out = [...lines];
  for (const l of [...located].sort((a, b) => b.startLine - a.startLine)) {
    out.splice(l.startLine - 1, l.endLine - l.startLine + 1, ...replacementLines(l.edit.replacement));
  }

  // 置き換えたあとの行の範囲：自分より上でかけた置き換えの、行数の増減だけずれる
  const applied = located.map((l): AppliedLineEdit => {
    let shift = 0;
    for (const other of located) {
      if (other.startLine < l.startLine) shift += replacementLines(other.edit.replacement).length - (other.endLine - other.startLine + 1);
    }
    const startLine = l.startLine + shift;
    return { id: l.edit.id, startLine, endLine: startLine + replacementLines(l.edit.replacement).length - 1 };
  });
  const order = new Map(edits.map((e, i) => [e.id, i]));
  skipped.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { body: out.join("\n"), applied, skipped };
}

// ---------------------------------------------------------------------------
// 入力（MCP の create_edit_request と、管理画面から出す API が同じものを使う）
// ---------------------------------------------------------------------------

/** 1回のリクエストの項目の数と、文字の長さの上限。 */
export const EDIT_REQUEST_LIMITS = {
  /** 1回のリクエストに入れられる項目の数 */
  items: 50,
  /** 置き換え案の長さ（文字） */
  replacement: 20_000,
  /** 理由の長さ（文字） */
  reason: 2_000,
  /** 全体へのひとことの長さ（文字） */
  comment: 2_000,
  /** 指摘の本文の長さ（文字） */
  note: 2_000,
  /** 返信の本文の長さ（文字） */
  reply: 2_000,
  /** 1つの項目に付けられる返信の数 */
  repliesPerItem: 200,
} as const;

/**
 * 項目の種類。
 * - suggestion: 提案。置き換え案を持つ。未対応 → 採用 / 却下
 * - note: 指摘。置き換え案を持たず、本文（プレーンテキスト）を持つ。未対応 → 解決済み
 */
export const EDIT_REQUEST_ITEM_KINDS = ["suggestion", "note"] as const;
export type EditRequestItemKind = (typeof EDIT_REQUEST_ITEM_KINDS)[number];

const lineRange = {
  /** 行の範囲（1から数え、両端を含む）。行の数え方は `bodyLines` */
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
};

/** 提案：行の範囲を、置き換え案で置き換える。`kind` は省ける（省くと提案） */
export type EditRequestSuggestionInput = { kind?: "suggestion"; startLine: number; endLine: number; replacement: string; reason?: string };
/** 指摘：行の範囲に、本文（プレーンテキスト）を付ける。置き換え案は持たない */
export type EditRequestNoteInput = { kind: "note"; startLine: number; endLine: number; body: string };
export type EditRequestItemInput = EditRequestSuggestionInput | EditRequestNoteInput;

export const editRequestItemInput = z
  .preprocess(
    // `kind` を省いた項目は提案（指摘を足す前からの入力を、そのまま受け付ける）
    (v) => (typeof v === "object" && v !== null && !Array.isArray(v) && (v as { kind?: unknown }).kind === undefined ? { ...v, kind: "suggestion" } : v),
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("suggestion"),
        ...lineRange,
        /** 置き換える文面（Markdown）。空の文字なら、その行を消す */
        replacement: z.string().max(EDIT_REQUEST_LIMITS.replacement),
        reason: z.string().trim().max(EDIT_REQUEST_LIMITS.reason).optional(),
      }),
      z
        .object({
          kind: z.literal("note"),
          ...lineRange,
          /** 指摘の本文（プレーンテキスト）。必須 */
          body: z.string().trim().min(1).max(EDIT_REQUEST_LIMITS.note),
        })
        // 指摘に置き換え案や理由を渡したら、黙って捨てずに断る
        .strict(),
    ]),
  )
  .refine((v) => v.endLine >= v.startLine, { message: "endLine must not be before startLine", path: ["endLine"] });

export const createEditRequestInput = z.object({
  /** 基準の版。最新の版（`headVersionId`）でなければ受け付けない */
  baseVersionId: z.string().uuid(),
  /** 全体へのひとこと */
  comment: z.string().trim().max(EDIT_REQUEST_LIMITS.comment).optional(),
  items: z.array(editRequestItemInput).min(1).max(EDIT_REQUEST_LIMITS.items),
});
export type CreateEditRequestInput = { baseVersionId: string; comment?: string; items: EditRequestItemInput[] };

/** 項目への返信（`POST edit-request-items/:itemId/comments`、MCP の `reply_edit_request_item`）。本文はプレーンテキスト */
export const editRequestCommentInput = z.object({ body: z.string().trim().min(1).max(EDIT_REQUEST_LIMITS.reply) });
export type EditRequestCommentInput = z.infer<typeof editRequestCommentInput>;

// ---------------------------------------------------------------------------
// API の応答
// ---------------------------------------------------------------------------

/**
 * 項目の状態。
 * - open: 未対応 / accepted: 採用 / rejected: 却下 / resolved: 解決済み / withdrawn: 取り下げ
 * - 提案は open → accepted / rejected（rejected は open に戻せる）、指摘は open → resolved（open に戻せる）。どちらも open から withdrawn にできる
 *
 * **「未対応」は、種類を問わず `status === "open"`**（`isOpenEditRequestItem`）。リクエストは、未対応の項目が0件になったら完了。
 * 「古くなった」は状態ではない（未対応のまま残る）。読むたびに、最新の版から決める（`EditRequestItem.stale`）。
 */
export const EDIT_REQUEST_ITEM_STATUSES = ["open", "accepted", "rejected", "resolved", "withdrawn"] as const;
export type EditRequestItemStatus = (typeof EDIT_REQUEST_ITEM_STATUSES)[number];

/** 未対応の項目か（提案も指摘も同じ決まり）。件数の数え方は、サーバーの `countOpenItems` と同じ */
export const isOpenEditRequestItem = (item: { status: EditRequestItemStatus }) => item.status === "open";

export type EditRequestPerson = { id: string; name: string };

/** 項目への返信。本文はプレーンテキスト（HTML としても Markdown としても描かない）。書き換え・削除はできない */
export type EditRequestComment = {
  id: string;
  itemId: string;
  body: string;
  /** 書いた人。外部のアプリ（MCP）から書いたものは、許可した人 */
  createdBy: EditRequestPerson;
  /** 外部のアプリ（MCP）から書いたものなら、そのアプリの名前 */
  via: string | null;
  createdAt: string;
};

export type EditRequestItem = {
  id: string;
  requestId: string;
  kind: EditRequestItemKind;
  status: EditRequestItemStatus;
  /** 基準の版と、そこでの行の範囲・文面 */
  baseVersionId: string;
  startLine: number;
  endLine: number;
  originalText: string;
  /** 提案の、置き換える文面。空の文字なら、その行を消す提案。指摘では null */
  replacement: string | null;
  /** 提案の理由（任意）。指摘では null */
  reason: string | null;
  /** 指摘の本文（プレーンテキスト）。提案では null */
  body: string | null;
  /** 採用・却下・解決済み・取り下げを決めた人と日時。未対応なら null */
  decidedBy: EditRequestPerson | null;
  decidedAt: string | null;
  /** 採用でできた版 */
  acceptedVersionId: string | null;
  /**
   * 最新の版での行の範囲（元の文面がある場所）。場所を決められなければ null。
   * 未対応・却下・解決済みの項目にだけ付く（採用・取り下げの項目は、いつも null）
   */
  current: { startLine: number; endLine: number } | null;
  /**
   * 未対応の項目の箇所が、最新の版では書き換えられている理由（「古くなった」）。そのままなら null。
   * 古くなった提案は採用できない（却下・取り下げはできる）。古くなった指摘も、解決済みにできる
   */
  stale: StaleReason | null;
  /** 返信（古い順） */
  comments: EditRequestComment[];
};

export type EditRequest = {
  id: string;
  pageId: string;
  /** 全体へのひとこと */
  comment: string | null;
  /** 出した人。外部のアプリ（MCP）から出したものは、許可した人 */
  createdBy: EditRequestPerson;
  /** 外部のアプリ（MCP）から出したものなら、そのアプリの名前 */
  via: string | null;
  createdAt: string;
  items: EditRequestItem[];
};

/** `GET /pages/:id/edit-requests`：そのページのリクエスト（新しい順）。 */
export type PageEditRequests = {
  /** 項目の `current` と `stale` を決めた、最新の版 */
  headVersionId: string;
  /** 最新の版の本文（項目の位置は、この本文の行で数えている） */
  headBodyMd: string;
  /** 未対応の項目の数（提案も指摘も。古くなったものも含む） */
  openCount: number;
  requests: EditRequest[];
};

/** `POST /pages/:id/edit-requests`：作ったリクエストと、項目の ID（渡した順）。 */
export type CreatedEditRequest = { id: string; itemIds: string[] };

/** `GET /pages/:id/edit-requests/count` */
export type EditRequestCount = { open: number };

/**
 * wiki ごとの一覧の絞り込み。リクエストに状態の列は無く、項目から決まる。
 * - open: 未対応の項目が1件以上ある
 * - done: 未対応の項目が0件（採用・却下・解決済みで片付いたもの。取り下げだけで0件になったものも入る）
 */
export const EDIT_REQUEST_LIST_STATUSES = ["open", "done"] as const;
export type EditRequestListStatus = (typeof EDIT_REQUEST_LIST_STATUSES)[number];
export const isEditRequestListStatus = (value: unknown): value is EditRequestListStatus =>
  (EDIT_REQUEST_LIST_STATUSES as readonly unknown[]).includes(value);

/** wiki ごとの一覧の1行（リクエスト1件）。項目の中身は持たない（読むのは、ページのレビュー画面） */
export type EditRequestListItem = {
  id: string;
  pageId: string;
  pageTitle: string;
  /** ページのアイコン（絵文字） */
  pageIcon: string | null;
  /** 全体へのひとこと */
  comment: string | null;
  /** 出した人。外部のアプリ（MCP）から出したものは、許可した人 */
  createdBy: EditRequestPerson;
  /** 外部のアプリ（MCP）から出したものなら、そのアプリの名前 */
  via: string | null;
  createdAt: string;
  /** 項目の数と、そのうち未対応の数（数え方は `isOpenEditRequestItem` と同じ） */
  itemCount: number;
  openCount: number;
  /**
   * 最後の動きの日時：出した日時、項目の採否を決めた日時（採用・却下・解決済み・取り下げ）、返信の日時のうち、いちばん新しいもの。
   * 一覧の並びには使わない（並びは出した日時の新しい順）
   */
  lastActivityAt: string;
};

/** `GET /edit-requests?status=open|done|open,done&limit=&cursor=`：その wiki のリクエスト（出した日時の新しい順）。ゴミ箱のページのものは入らない */
export type EditRequestList = {
  requests: EditRequestListItem[];
  /** 続きがあれば、次の呼び出しの `cursor` に渡す値。無ければ null */
  nextCursor: string | null;
};

/** `GET /edit-requests/count`：未対応の項目があるページの数（項目の数でも、リクエストの数でもない）。ゴミ箱のページは数えない */
export type EditRequestPageCount = { pages: number };

/** 採用で、かけられなかった項目。draft_conflict は、編集中の人の下書きで元の文面が見つからなかったもの */
export type EditRequestSkipped = {
  itemId: string;
  reason: StaleReason | "overlap" | "draft_conflict";
  /** draft_conflict のとき、編集中の人 */
  editors?: EditRequestPerson[];
};

/** 採用の結果（1件の採用と「すべて採用」で同じ形）。 */
export type AcceptEditRequestResult = {
  /** 採用のあとの最新の版 */
  headVersionId: string;
  /** 採用でできた版。1件もかけられなかったら null */
  versionId: string | null;
  /** 採用した項目と、新しい版での行の範囲 */
  applied: { itemId: string; startLine: number; endLine: number }[];
  skipped: EditRequestSkipped[];
};

/**
 * `GET /pages/:id/edit-requests/applied?since={版のID}`：その版のあとに、採用でできた版の置き換え。
 * 編集画面が、開いたままの手元の内容に同じ置き換えをかけるのに使う。
 */
export type AppliedEditRequests = {
  headVersionId: string;
  /**
   * 手元の内容に取り込めるか。`since` から最新の版までのあいだに、採用（と、自分の下書きから自動でできた版）以外の版が
   * 挟まっていたら false（だれかがふつうに保存した。取り込めない）
   */
  mergeable: boolean;
  /** 古い順。`mergeable` が false なら空 */
  steps: {
    versionId: string;
    acceptedBy: EditRequestPerson | null;
    edits: { itemId: string; originalText: string; replacement: string }[];
  }[];
};
