import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/react";
import { bodyLines, replacementLines, sliceLines } from "@wiki/shared";
import { editorExtensions } from "../editor/extensions";
import { parseBodyWithLines, type BlockUnit, type UnitSelection } from "./blockLines";

/**
 * 編集リクエストを画面から出すときの、「本文で選んだ範囲 ⇄ 小さなエディタの中身」の行き来。
 *
 * 提案は「本文（Markdown）の行の範囲を、この文面で置き換える」という形なので、小さなエディタ（WYSIWYG）が書き出した Markdown を、
 * 選んだ行の範囲にそのまま入れられる形に戻す必要がある。ブロックの種類ごとの扱い：
 *
 * - **いちばん上の階層のブロック**（段落・見出し・コードブロック・引用・コールアウト・トグル・区切り線・画像、リスト全体、表全体。続けて複数でも）:
 *   その行をそのままエディタに入れ、書き出したものをそのまま置き換え案にする
 * - **リストの項目**（入れ子の項目も。続けて複数でも）: 字下げを外してエディタに入れ（1つのリストとして見える）、書き出したものに字下げを戻す。
 *   項目の印（`*` `+`、`1)`）は元の書き方に戻す（印が変わると、Markdown では別のリストに分かれるため）。リストでないものには変えられない
 * - **表の行**（続けて複数でも）: 行だけでは表にならないので、見出しの行と区切りの行を付けてエディタに入れる。書き出したものから、
 *   選んだ行だけを取り出す。選んでいない見出しの行と、列の数は変えられない。変わらなかった行は元の文面のまま、変わった行は元の行の幅に合わせる
 *
 * コードブロック・引用・コールアウト・トグルの中の行は、ブロックまるごとをエディタに入れる（囲みの外に出すと別のものになるため）。
 * そのうえで `buildSuggestion` が、置き換え案を**変わった行だけに絞る**ので、コードブロックの1行だけを直した提案は、その行だけの提案になる。
 */

let sharedManager: MarkdownManager | null = null;
const manager = () => (sharedManager ??= new MarkdownManager({ extensions: editorExtensions, markedOptions: { gfm: true } }));

/** 本文をエディタと同じ読み方で文書にする（テストと、書き出しの確かめに使う）。 */
export const parseMarkdown = (markdown: string): JSONContent => manager().parse(markdown);
/** 文書を、エディタと同じ書き出し方で Markdown にする。 */
export const serializeMarkdown = (doc: JSONContent): string => manager().serialize(doc);

export type Restored = { ok: true; replacement: string } | { ok: false; reason: string };

export type EditorInput = {
  /** 小さなエディタに入れる Markdown */
  markdown: string;
  /** エディタが書き出した Markdown を、選んだ行の範囲に入れる置き換え案に戻す。戻せない書き換えは、理由を返す */
  restore: (serialized: string) => Restored;
  /** 何も書き換えずに書き出したときの置き換え案（「元の文面と同じ」を見分けるのに使う） */
  unchanged: string;
};

const INDENT = /^[ \t]*/;
/** リストの項目の印（字下げを外したあとの行頭） */
const MARKER = /^([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const trimNewlines = (s: string) => s.replace(/^\n+|\n+$/g, "");

/** 表の行を、セルの文面（前後の空白つき）に分ける。`\|` は区切りにしない */
function rawCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  const text = line.trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      cell += ch + text[++i]!;
    } else if (ch === "|") {
      // 行頭の `|` の前は、セルではない
      if (i > 0) cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.trim() !== "") cells.push(cell);
  return cells;
}
const cellsOf = (line: string) => rawCells(line).map((c) => c.trim());
const sameCells = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/** 表の行を書く。セルの幅は、元の行（`like`）に合わせる（元の行より長い文面は、そのぶん伸びる） */
function tableLine(cells: readonly string[], like: string): string {
  const widths = rawCells(like).map((raw) => (raw.length >= 2 && raw.startsWith(" ") && raw.endsWith(" ") ? raw.length - 2 : raw.trim().length));
  return `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ")} |`;
}

const TABLE_REASONS = {
  outside: "表の行を選んだときは、行の中身だけを書き換えられます。表の外に書く・表でないものに変えるときは、「範囲を広げる」で表全体を選んでください。",
  columns: "表の行を選んだときは、列の数を変えられません。列を足す・消すときは、「範囲を広げる」で表全体を選んでください。",
  header: "見出しの行は選んでいないので、変えられません。見出しも直すときは、「範囲を広げる」で見出しの行まで選んでください。",
  headerOnly: "見出しの行だけを選んだときは、行を足せません。行を足すときは、「範囲を広げる」で下の行も選んでください。",
  headerGone: "見出しの行は消せません。表ごと消すときは、「範囲を広げる」で表全体を選んでください。",
} as const;
const LIST_REASON = "リストの項目を選んだときは、項目のまま書き換えます。リストでないもの（段落や見出しなど）に変えるときは、「範囲を広げる」でリスト全体を選んでください。";

function listItemInput(lines: string[]): Pick<EditorInput, "markdown" | "restore"> {
  const indent = INDENT.exec(lines[0]!)![0];
  const marker = MARKER.exec(lines[0]!.slice(indent.length))?.[1] ?? "-";
  const bullet = /^[-*+]$/.test(marker) ? marker : null;
  const paren = marker.endsWith(")");
  const markdown = lines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.replace(INDENT, ""))).join("\n");
  return {
    markdown,
    restore(serialized) {
      const out = trimNewlines(serialized);
      // 空にしたら、その項目を消す提案
      if (out === "") return { ok: true, replacement: "" };
      const restored: string[] = [];
      for (const line of out.split("\n")) {
        const mark = MARKER.exec(line)?.[1];
        // 字下げの無い行は、どれも項目の始まりのはず（項目の中身は、字下げして書き出される）
        if (line !== "" && !/^[ \t]/.test(line) && !mark) return { ok: false, reason: LIST_REASON };
        let fixed = line;
        // 項目の印を、元の書き方に戻す（エディタは `-` と `1.` で書き出す）
        if (mark && bullet && /^[-*+]$/.test(mark)) fixed = bullet + line.slice(1);
        else if (mark && paren && mark.endsWith(".")) fixed = `${mark.slice(0, -1)})${line.slice(mark.length)}`;
        restored.push(fixed === "" ? "" : indent + fixed);
      }
      return { ok: true, replacement: restored.join("\n") };
    },
  };
}

function tableRowInput(body: string, selection: UnitSelection): Pick<EditorInput, "markdown" | "restore"> {
  const lines = bodyLines(body);
  const tableStart = selection.parent!.startLine;
  const header = lines[tableStart - 1]!;
  const delimiter = lines[tableStart]!;
  const withHeader = selection.startLine === tableStart;
  // 見出しの行から選んだときの本体の行は、区切りの行のあと
  const rowStart = withHeader ? tableStart + 2 : selection.startLine;
  const rows = lines.slice(rowStart - 1, selection.endLine);
  const columns = cellsOf(header).length;
  const markdown = [header, delimiter, ...rows].join("\n");
  // 選んでいない見出しの行が変えられていないかは、エディタが書き出す形にそろえたもの同士で比べる
  let headerCells: string[] | null = null;
  const writtenHeader = () => (headerCells ??= cellsOf(trimNewlines(serializeMarkdown(parseMarkdown(markdown))).split("\n")[0] ?? ""));
  return {
    markdown,
    restore(serialized) {
      const out = trimNewlines(serialized);
      if (out === "") return withHeader ? { ok: false, reason: TABLE_REASONS.headerGone } : { ok: true, replacement: "" };
      const written = out.split("\n");
      if (written.length < 2 || written.some((l) => !l.trimStart().startsWith("|"))) return { ok: false, reason: TABLE_REASONS.outside };
      const [newHeader, , ...newRows] = written.map(cellsOf) as [string[], string[], ...string[][]];
      if ([newHeader, ...newRows].some((cells) => cells.length !== columns)) return { ok: false, reason: TABLE_REASONS.columns };
      if (!withHeader && !sameCells(newHeader, writtenHeader())) return { ok: false, reason: TABLE_REASONS.header };
      if (withHeader && rows.length === 0 && newRows.length > 0) return { ok: false, reason: TABLE_REASONS.headerOnly };
      const line = (cells: string[], original: string | undefined, like: string) =>
        // 変わらなかった行は、元の文面のまま（幅をそろえ直さない）
        original !== undefined && sameCells(cells, cellsOf(original)) ? original : tableLine(cells, like);
      const body = newRows.map((cells, i) => line(cells, rows[i], rows[Math.min(i, rows.length - 1)] ?? header));
      if (!withHeader) return { ok: true, replacement: body.join("\n") };
      const head = line(newHeader, header, header);
      return { ok: true, replacement: (rows.length === 0 ? [head] : [head, delimiter, ...body]).join("\n") };
    },
  };
}

/**
 * 選んだ範囲を、小さなエディタに入れる Markdown にする。エディタが書き出したものは `restore` で置き換え案に戻す。
 * `body` は、選んだ範囲を数えた本文（基準の版）。
 */
export function editorInputFor(body: string, selection: UnitSelection): EditorInput {
  const text = sliceLines(body, selection.startLine, selection.endLine) ?? "";
  const made =
    selection.kind === "listItem"
      ? listItemInput(bodyLines(text))
      : selection.kind === "tableRow" && selection.parent
        ? tableRowInput(body, selection)
        : { markdown: text, restore: (serialized: string): Restored => ({ ok: true, replacement: trimNewlines(serialized) }) };
  const unchanged = made.restore(serializeMarkdown(parseMarkdown(made.markdown)));
  return { ...made, unchanged: unchanged.ok ? unchanged.replacement : text };
}

// ---------------------------------------------------------------------------
// 置き換え案を、提案（行の範囲と文面）にする
// ---------------------------------------------------------------------------

export type BuiltSuggestion = {
  /** 提案の行の範囲（変わった行だけに絞ったもの）と、その元の文面 */
  startLine: number;
  endLine: number;
  originalText: string;
  /** 置き換える文面。空の文字なら、その行を消す */
  replacement: string;
};

export const SUGGESTION_REASONS = {
  same: "元の文面と同じです。書き換えてから追加してください。",
  neighbors:
    "この書き換えだと、前後のブロックとつながって、選んでいない箇所の形が変わってしまいます。「範囲を広げる」で前後のブロックも選んで、まとめて書き換えてください。",
} as const;

type Signature = { start: number; end: number; kind: string; type: string };

function signatures(body: string): Signature[] {
  const { doc, units } = parseBodyWithLines(body);
  const typeAt = (path: readonly number[]) => path.reduce<JSONContent | undefined>((node, i) => node?.content?.[i], doc)?.type ?? "";
  const flat = (list: readonly BlockUnit[]): Signature[] =>
    list.flatMap((u) => [{ start: u.startLine, end: u.endLine, kind: u.kind, type: typeAt(u.path) }, ...flat(u.children)]);
  return flat(units);
}

/**
 * 置き換えたあとも、選んでいないブロックが同じ形（同じ種類・同じ行）で残るか。
 * たとえば、リストに挟まれた段落を消すと前後のリストが1つにつながり、見出しを段落に変えると次の段落とつながる。そういう置き換えを見つける。
 */
export function neighborsKept(body: string, startLine: number, endLine: number, replacement: string): boolean {
  const lines = bodyLines(body);
  const added = replacementLines(replacement);
  const delta = added.length - (endLine - startLine + 1);
  const after = new Set(
    signatures([...lines.slice(0, startLine - 1), ...added, ...lines.slice(endLine)].join("\n")).map((s) => `${s.start}-${s.end}-${s.kind}-${s.type}`),
  );
  return signatures(body).every((s) => {
    // 選んだ範囲の中のブロックは、変わってよい
    if (s.start >= startLine && s.end <= endLine) return true;
    const expected =
      s.end < startLine
        ? s
        : s.start > endLine
          ? { ...s, start: s.start + delta, end: s.end + delta }
          : // 選んだ範囲を含むブロック（リスト・表・親の項目）は、行数だけが変わる
            { ...s, end: s.end + delta };
    return after.has(`${expected.start}-${expected.end}-${expected.kind}-${expected.type}`);
  });
}

/**
 * 小さなエディタから戻した置き換え案を、送る形の提案にする。
 *
 * - 元の文面と同じなら断る
 * - 前後のブロックとつながってしまう置き換えは、空行を足して離す。それでも離れなければ断る
 * - 行の範囲を、**変わった行だけ**に絞る（前後の、変わっていない行を外す）。同じブロックの別の行への提案とぶつからず、差分も短くなる
 */
export function buildSuggestion(body: string, selection: Pick<UnitSelection, "kind" | "startLine" | "endLine">, replacement: string): { ok: true; suggestion: BuiltSuggestion } | { ok: false; reason: string } {
  const lines = bodyLines(body);
  const original = lines.slice(selection.startLine - 1, selection.endLine);
  if (replacement !== "" && replacement === original.join("\n")) return { ok: false, reason: SUGGESTION_REASONS.same };
  // いちばん上の階層のブロックは、前後に空行を足せば離せる（リストの項目・表の行は、空行を足すとリスト・表が切れる）
  const candidates = selection.kind === "block" && replacement !== "" ? [replacement, `${replacement}\n`, `\n${replacement}`, `\n${replacement}\n`] : [replacement];
  const chosen = candidates.find((c) => neighborsKept(body, selection.startLine, selection.endLine, c));
  if (chosen === undefined) return { ok: false, reason: SUGGESTION_REASONS.neighbors };

  const next = replacementLines(chosen);
  let head = 0;
  while (head < original.length && head < next.length && original[head] === next[head]) head++;
  let tail = 0;
  while (tail < original.length - head && tail < next.length - head && original[original.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  // 行を足すだけの提案は、指す行が無くなる。空行1つだけの置き換え案は、「行を消す」と区別できない。どちらも、隣の行を1つ範囲に残す
  const needsContext = () => original.length - head - tail === 0 || (next.length - head - tail === 1 && next[head] === "");
  while (needsContext() && (head > 0 || tail > 0)) {
    if (head > 0) head--;
    else tail--;
  }
  const startLine = selection.startLine + head;
  const endLine = selection.endLine - tail;
  return {
    ok: true,
    suggestion: {
      startLine,
      endLine,
      originalText: lines.slice(startLine - 1, endLine).join("\n"),
      replacement: next.slice(head, next.length - tail).join("\n"),
    },
  };
}
