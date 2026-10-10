import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/**
 * 編集中のコードブロックの色分け。言語は CodeBlockMenu で選べるものだけを読み込む（全部入れると大きくなるため）。
 * `js` `ts` `md` `html` `sh` `yml` などの別名は、各言語の定義に含まれている。
 */
export const lowlight = createLowlight({ bash, css, diff, go, javascript, json, markdown, plaintext, python, ruby, rust, sql, typescript, xml, yaml });
// highlight.js に TSX・JSX の定義は無いので、近い言語で色分けする
lowlight.registerAlias({ typescript: ["tsx"], javascript: ["jsx"] });

/** 色分けの配色（GitHub の配色に合わせる。公開サイトも同じ系統）。[ライト, ダーク] */
const COLORS = {
  comment: ["#6a737d", "#8b949e"],
  keyword: ["#d73a49", "#ff7b72"],
  string: ["#032f62", "#a5d6ff"],
  number: ["#005cc5", "#79c0ff"],
  title: ["#6f42c1", "#d2a8ff"],
  tag: ["#22863a", "#7ee787"],
  attr: ["#005cc5", "#79c0ff"],
  variable: ["#e36209", "#ffa657"],
  addition: ["#22863a", "#7ee787"],
  deletion: ["#b31d28", "#ffa198"],
} as const;

const SELECTORS: Record<keyof typeof COLORS, string> = {
  comment: "& .hljs-comment, & .hljs-quote, & .hljs-meta",
  keyword: "& .hljs-keyword, & .hljs-selector-tag, & .hljs-doctag, & .hljs-template-tag, & .hljs-type",
  string: "& .hljs-string, & .hljs-regexp, & .hljs-meta .hljs-string",
  number: "& .hljs-number, & .hljs-literal, & .hljs-symbol, & .hljs-bullet",
  title: "& .hljs-title, & .hljs-section, & .hljs-selector-id, & .hljs-selector-class",
  tag: "& .hljs-name, & .hljs-selector-pseudo",
  attr: "& .hljs-attr, & .hljs-attribute, & .hljs-property, & .hljs-built_in",
  variable: "& .hljs-variable, & .hljs-template-variable, & .hljs-params .hljs-variable",
  addition: "& .hljs-addition",
  deletion: "& .hljs-deletion",
};

const scheme = (index: 0 | 1) => Object.fromEntries((Object.keys(COLORS) as (keyof typeof COLORS)[]).map((k) => [SELECTORS[k], { color: COLORS[k][index] }]));

/** エディタの `pre` に当てるスタイル。配色は OS の設定に追従する（theme.ts と同じ）。 */
export const highlightSx = {
  ...scheme(0),
  "@media (prefers-color-scheme: dark)": scheme(1),
  "& .hljs-emphasis": { fontStyle: "italic" },
  "& .hljs-strong": { fontWeight: 700 },
};
