import type { JSONContent } from "@tiptap/react";
import { MarkdownManager } from "@tiptap/markdown";
import { bodyLines } from "@wiki/shared";
import { editorExtensions } from "../editor/extensions";

/**
 * 本文（Markdown）の行の範囲と、画面のブロックの対応付け。
 *
 * 編集リクエストの項目は、位置を「本文の行の範囲」で持つ（行の数え方は `@wiki/shared` の `bodyLines`）。
 * レビュー画面は、本文をエディタと同じ読み方でブロックの並び（Tiptap の文書）にして出すので、
 * 「何行目から何行目が、どのブロックか」をここで作る。
 *
 * 作り方：エディタと同じ Markdown の読み手（`MarkdownManager`）に本文を読ませ、読み手が Markdown の
 * かたまり（marked のトークン）1つをブロックにするたびに、その組を覚える。トークンは元の文面（`raw`）を持つので、
 * 本文の中の位置＝行が分かる。DOM には寄らない。
 *
 * 対応付けの細かさ：いちばん上の階層のブロック（段落・見出し・リスト・表・コードブロック・引用・トグル…）と、
 * その中のリストの項目（入れ子も）・表の行。引用・コールアウト・トグルの中身と、コードブロックの中の行は、ブロック全体で1つ。
 */

/** 本文の行の範囲（1から数え、両端を含む）と、それを表すブロック。 */
export type BlockUnit = {
  startLine: number;
  endLine: number;
  /** block: いちばん上の階層のブロック / listItem: リストの項目 / tableRow: 表の行 */
  kind: "block" | "listItem" | "tableRow";
  /** 文書の中のブロックの場所。いちばん上の階層から、何番目の子かを順に並べたもの */
  path: number[];
  /** リストなら項目、表なら行。項目の中の入れ子のリストの項目も、その項目の下に入る */
  children: BlockUnit[];
};

type Token = { type?: string; raw?: string; rows?: unknown[] };

/** 読み手の、トークン1つをブロックにする所（型の上では外から触れないが、ここで間に入る） */
type TokenParser = { parseToken?: (token: Token, implicit?: boolean) => JSONContent | JSONContent[] | null };

const newlines = (s: string) => (s.match(/\n/g) ?? []).length;

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
/** リストの項目の始まりの行（字下げ、項目の印、空白か行末） */
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * 本文を、エディタと同じ読み方で文書にし、行の範囲とブロックの対応付けも返す。
 * `doc` は、そのまま読み取り専用のエディタに入れられる（`path` は、この `doc` の中の場所）。
 */
export function parseBodyWithLines(bodyMd: string): { doc: JSONContent; units: BlockUnit[] } {
  const manager = new MarkdownManager({ extensions: editorExtensions, markedOptions: { gfm: true } });
  // 読み手がトークンをブロックにするたびに、その組を覚える（入れ子の中のトークンも通る）
  const produced = new Map<Token, JSONContent[]>();
  const topLevel: Token[] = [];
  let depth = 0;
  const parser = manager as unknown as TokenParser;
  const original = parser.parseToken?.bind(manager);
  // 読み手の作りが変わって間に入れなくなったら、対応付けは空になる（本文は出る。項目は、場所を示さずに並ぶ）
  if (original) {
    parser.parseToken = (token, implicit) => {
      if (depth === 0) topLevel.push(token);
      depth++;
      try {
        const parsed = original(token, implicit);
        produced.set(token, parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]);
        return parsed;
      } finally {
        depth--;
      }
    };
  }
  const doc = manager.parse(bodyMd);

  // 文書の中の、ブロックの場所
  const paths = new Map<JSONContent, number[]>();
  const index = (nodes: JSONContent[] | undefined, parent: number[]) => {
    nodes?.forEach((node, i) => {
      const path = [...parent, i];
      paths.set(node, path);
      index(node.content, path);
    });
  };
  index(doc.content, []);

  // marked は、読む前に改行をそろえる。トークンの文面を本文の中で探すので、同じようにそろえておく（\r\n は行数が変わらない）
  const source = bodyMd.replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  /** その行がリストの項目の始まりなら、字下げの幅。そうでなければ -1 */
  const markerIndent = (line: number) => LIST_MARKER.exec(lines[line - 1] ?? "")?.[1]!.length ?? -1;

  /**
   * リストの項目ごとの対応を作る。項目の始まりは、本文の行から決める：リストの最初の行と同じ字下げで、行頭に項目の印（`-` `1.` など）がある行。
   * その行数が項目の数と合わないリスト（読み手の分け方が、行の見た目と違った）は、リスト全体で1つにする。
   * `lists` は、同じ字下げで続くリスト（種類の違う項目が混ざると、読み手は別々のリストに分ける）。
   */
  const listItems = (lists: JSONContent[], startLine: number, endLine: number): BlockUnit[] => {
    const base = markerIndent(startLine);
    const nodes = lists.flatMap((list) => list.content ?? []);
    const starts: number[] = [];
    for (let line = startLine; line <= endLine; line++) if (base >= 0 && markerIndent(line) === base) starts.push(line);
    if (nodes.length === 0 || starts.length !== nodes.length) return [];
    return nodes.flatMap((node, i) => {
      const path = paths.get(node);
      if (!path) return [];
      const first = starts[i]!;
      let last = (starts[i + 1] ?? endLine + 1) - 1;
      // 項目のあとの空行は、次の項目との間
      while (last > first && (lines[last - 1] ?? "").trim() === "") last--;
      // 入れ子のリスト：項目の中で、もっと字下げした項目の印が最初に出る行から
      const nested = (node.content ?? []).filter((n) => LIST_TYPES.has(n.type ?? ""));
      let nestedStart = -1;
      for (let line = first + 1; line <= last && nestedStart < 0; line++) if (markerIndent(line) > base) nestedStart = line;
      const children = nested.length > 0 && nestedStart > 0 ? listItems(nested, nestedStart, last) : [];
      return [{ startLine: first, endLine: last, kind: "listItem" as const, path, children }];
    });
  };

  /** 表の行。GFM の表は、見出しの行・区切りの行・本体の行が、それぞれ本文の1行 */
  const tableRows = (token: Token, startLine: number): BlockUnit[] => {
    const [table] = produced.get(token) ?? [];
    const rows = table?.type === "table" ? (table.content ?? []) : [];
    if (rows.length !== (token.rows?.length ?? 0) + 1) return [];
    return rows.flatMap((row, i) => {
      const path = paths.get(row);
      // 見出しの行は1行目、本体の行は区切りの行（2行目）のあと
      const line = startLine + (i === 0 ? 0 : i + 1);
      return path ? [{ startLine: line, endLine: line, kind: "tableRow" as const, path, children: [] }] : [];
    });
  };

  const lineOfOffset = (offset: number) => newlines(source.slice(0, offset)) + 1;
  const units: BlockUnit[] = [];
  let cursor = 0;
  for (const token of topLevel) {
    // 末尾の改行は探すのに使わない（読み手が、本文に無い改行を足していることがある）
    const raw = (token.raw ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const at = raw === "" ? -1 : source.indexOf(raw, cursor);
    if (at < 0) continue;
    cursor = at + raw.length;
    const nodes = produced.get(token) ?? [];
    const startLine = lineOfOffset(at);
    const endLine = startLine + newlines(raw);
    // 1つのトークンから複数のブロックができることがある（種類の違う項目が混ざったリストは、種類ごとのリストに分かれる）
    const top = nodes.filter((node) => paths.get(node)?.length === 1);
    const lists = top.filter((node) => LIST_TYPES.has(node.type ?? ""));
    const items = lists.length === top.length ? listItems(lists, startLine, endLine) : [];
    for (const node of top) {
      const path = paths.get(node)!;
      const children = token.type === "table" ? tableRows(token, startLine) : items.filter((u) => u.path[0] === path[0]);
      // 分かれたリストは、それぞれの項目の行の範囲にする
      const split = lists.length > 1 && children.length > 0;
      units.push({
        startLine: split ? children[0]!.startLine : startLine,
        endLine: split ? children[children.length - 1]!.endLine : endLine,
        kind: "block",
        path,
        children,
      });
    }
  }
  return { doc, units };
}

export type LineTarget = {
  /** その行の範囲を表すブロック（いちばん細かいもの）。印を付ける。空行だけを指すなど、当てはまるブロックが無ければ空 */
  blocks: number[][];
  /**
   * 項目を出す場所。本文にブロックが1つも無ければ null（本文の先頭に出す）。
   * - after: このブロックのすぐ下
   * - inside: このブロック（リストの項目）の中の末尾
   * - insideAfterFirst: このブロック（リストの項目）の中の、最初の子のすぐ下（入れ子のリストの手前）
   */
  anchor: { path: number[]; place: "after" | "inside" | "insideAfterFirst" } | null;
};

const intersects = (u: BlockUnit, startLine: number, endLine: number) => u.startLine <= endLine && startLine <= u.endLine;

/** 行の範囲に当たるブロックのうち、いちばん細かいもの（上から順）。 */
function finest(units: readonly BlockUnit[], startLine: number, endLine: number): BlockUnit[] {
  return units
    .filter((u) => intersects(u, startLine, endLine))
    .flatMap((u) => {
      const inner = finest(u.children, startLine, endLine);
      return inner.length > 0 ? inner : [u];
    });
}

/**
 * 行の範囲（1から数え、両端を含む）を、画面のブロックに対応付ける。
 * 範囲が空（`endLine < startLine`。行を消したあとの場所）のときは、その行の直前のブロックの下を返す。
 */
export function targetForLines(units: readonly BlockUnit[], startLine: number, endLine: number): LineTarget {
  const hit = endLine >= startLine ? finest(units, startLine, endLine) : [];
  const last = hit[hit.length - 1];
  if (last) {
    const blocks = hit.map((u) => u.path);
    // リストの項目は、項目の中に出す。入れ子のリストを持つ項目で、入れ子には当たっていないなら、入れ子の手前に出す
    if (last.kind === "listItem") return { blocks, anchor: { path: last.path, place: last.children.length > 0 ? "insideAfterFirst" : "inside" } };
    // 表の行の下には出せない（表が崩れる）ので、表の下に出す
    return { blocks, anchor: { path: [last.path[0]!], place: "after" } };
  }
  // 当たるブロックが無い（空行だけ、消した行）：その行より前で、いちばん近いブロックの下
  const before = [...units].reverse().find((u) => u.startLine <= Math.max(startLine, 1));
  const near = before ?? units[0];
  return { blocks: [], anchor: near ? { path: [near.path[0]!], place: "after" } : null };
}

/** 本文の行数（`bodyLines` と同じ数え方）。 */
export const bodyLineCount = (bodyMd: string) => bodyLines(bodyMd).length;

// ---------------------------------------------------------------------------
// 選べる単位（編集リクエストを出すとき、本文のどこを選べるか）
// ---------------------------------------------------------------------------

/**
 * 本文で選んだ範囲。**同じ階層で隣り合うブロック**のまとまりで、行の範囲は、その最初の行から最後の行まで。
 *
 * - block: いちばん上の階層のブロック（段落・見出し・リスト全体・表全体・コードブロック・引用・コールアウト・トグル…）
 * - listItem: 同じリストの、続いた項目（入れ子の項目は、親の項目といっしょに入る）
 * - tableRow: 同じ表の、続いた行（見出しの行から選ぶと、区切りの行 `| --- |` も範囲に入る）
 *
 * リストの項目・表の行をすべて選んだら、リスト全体・表全体を選んだものとして扱う（`kind` は block になる）。
 */
export type UnitSelection = {
  kind: BlockUnit["kind"];
  startLine: number;
  endLine: number;
  /** 選んだブロック（上から順） */
  units: BlockUnit[];
  /** 選んだブロックの親（リストの項目なら、リストか親の項目。表の行なら、表）。いちばん上の階層なら null */
  parent: BlockUnit | null;
};

const samePath = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** いちばん上の階層から、その場所のブロックまでの道すじ。無ければ null */
function chainTo(units: readonly BlockUnit[], path: readonly number[]): BlockUnit[] | null {
  for (const u of units) {
    if (samePath(u.path, path)) return [u];
    const inner = chainTo(u.children, path);
    if (inner) return [u, ...inner];
  }
  return null;
}

/** 兄弟の `from`〜`to` 番目を選んだ範囲にする。親（リスト・表）の子をすべて選んだら、親を選んだことにする */
function pick(units: readonly BlockUnit[], siblings: readonly BlockUnit[], from: number, to: number, parent: BlockUnit | null): UnitSelection {
  if (parent && parent.kind === "block" && from === 0 && to === siblings.length - 1) {
    const at = units.indexOf(parent);
    if (at >= 0) return pick(units, units, at, at, null);
  }
  const chosen = siblings.slice(from, to + 1);
  return { kind: chosen[0]!.kind, startLine: chosen[0]!.startLine, endLine: chosen[chosen.length - 1]!.endLine, units: chosen, parent };
}

/**
 * 選べるブロック（上から順）。**何を1つとして選べるかは、ここで決まる**：
 * 段落・見出し・コードブロック・引用・コールアウト・トグル・区切り線・画像は、ブロックまるごと。リストは項目ごと（入れ子の項目も。
 * 入れ子を持つ項目を選ぶと、入れ子ごと選ぶ）、表は行ごと。リスト全体・表全体は、項目・行をすべて選ぶと選べる。
 */
export function selectableUnits(units: readonly BlockUnit[]): BlockUnit[] {
  return units.flatMap((u) => {
    if (u.children.length === 0) return [u];
    return u.kind === "listItem" ? [u, ...selectableUnits(u.children)] : selectableUnits(u.children);
  });
}

/**
 * 2つのブロック（文書の中の場所）を両端にして選ぶ。同じ場所を渡せば、そのブロック1つ。
 * 階層が違うときは、両方が入る階層まで上がって、そこで隣り合うブロックを選ぶ（リストの項目と、その下の段落なら、リスト全体から段落まで）。
 */
export function selectBetween(units: readonly BlockUnit[], a: readonly number[], b: readonly number[]): UnitSelection | null {
  const chainA = chainTo(units, a);
  const chainB = chainTo(units, b);
  if (!chainA || !chainB) return null;
  let depth = 0;
  while (depth < chainA.length && depth < chainB.length && chainA[depth] === chainB[depth]) depth++;
  // 片方が、もう片方を含んでいる（か、同じ）：含んでいるほうを1つ選ぶ
  if (depth === chainA.length || depth === chainB.length) depth--;
  const parent = depth > 0 ? chainA[depth - 1]! : null;
  const siblings = parent ? parent.children : units;
  const i = siblings.indexOf(chainA[depth]!);
  const j = siblings.indexOf(chainB[depth]!);
  return pick(units, siblings, Math.min(i, j), Math.max(i, j), parent);
}

/**
 * 選んだ範囲を、上か下へ1つ広げる。同じ階層に隣のブロックが無ければ、親（リスト全体・表全体・親の項目）へ広げる。
 * もう広げられなければ null。
 */
export function extendSelection(units: readonly BlockUnit[], selection: UnitSelection, direction: "up" | "down"): UnitSelection | null {
  const siblings = selection.parent ? selection.parent.children : units;
  const from = siblings.indexOf(selection.units[0]!);
  const to = siblings.indexOf(selection.units[selection.units.length - 1]!);
  if (from < 0 || to < 0) return null;
  if (direction === "up" && from > 0) return pick(units, siblings, from - 1, to, selection.parent);
  if (direction === "down" && to < siblings.length - 1) return pick(units, siblings, from, to + 1, selection.parent);
  if (!selection.parent) return null;
  return selectBetween(units, selection.parent.path, selection.parent.path);
}

/**
 * 行の範囲から、選んだ範囲を作り直す（本文が新しい版になったあと、同じ文面を探し直した場所で使う）。
 * その行の範囲が、同じ階層で隣り合うブロックにちょうど重ならなければ null。
 */
export function selectionForLines(units: readonly BlockUnit[], kind: BlockUnit["kind"], startLine: number, endLine: number): UnitSelection | null {
  const find = (siblings: readonly BlockUnit[], parent: BlockUnit | null): UnitSelection | null => {
    const hit = siblings.filter((u) => intersects(u, startLine, endLine));
    if (hit.length === 0) return null;
    const exact = hit[0]!.startLine === startLine && hit[hit.length - 1]!.endLine === endLine;
    // 同じ行の範囲が、親と子の両方に当てはまることがある（入れ子の項目など）。種類が合うほうを選ぶ
    const inner = hit.length === 1 && hit[0]!.children.length > 0 ? find(hit[0]!.children, hit[0]!) : null;
    if (inner && (!exact || inner.kind === kind)) return inner;
    if (!exact) return null;
    return { kind: hit[0]!.kind, startLine, endLine, units: hit, parent };
  };
  const found = find(units, null);
  return found && found.kind === kind ? found : null;
}

/**
 * 選んだ範囲に付けて出すもの（入力欄、送信前の項目）の場所。印は選んだブロックそのものに付け、出す場所は、その最後のブロックのすぐ下。
 * `targetForLines` は、いちばん細かいブロックに寄せる（入れ子を持つ項目を選んでも、入れ子の最後の項目の中に出る）ので、選んだ範囲には使わない。
 */
export function targetForSelection(selection: UnitSelection): LineTarget {
  const last = selection.units[selection.units.length - 1]!;
  return {
    blocks: selection.units.map((u) => u.path),
    // リストの項目は、項目の中の末尾（入れ子のリストのあと）。表の行の下には出せないので、表の下
    anchor: last.kind === "listItem" ? { path: last.path, place: "inside" } : { path: [last.path[0]!], place: "after" },
  };
}
