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
import { type HighlightName } from "../lib/highlightColors";

/**
 * 編集中のコードブロックの色分け。言語は CodeBlockMenu で選べるものだけを読み込む（全部入れると大きくなるため）。
 * `js` `ts` `md` `html` `sh` `yml` などの別名は、各言語の定義に含まれている。
 */
export const lowlight = createLowlight({ bash, css, diff, go, javascript, json, markdown, plaintext, python, ruby, rust, sql, typescript, xml, yaml });
// highlight.js に TSX・JSX の定義は無いので、近い言語で色分けする
lowlight.registerAlias({ typescript: ["tsx"], javascript: ["jsx"] });

const SELECTORS: Record<HighlightName, string> = {
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

/** エディタの `pre` に当てるスタイル。色は `:root` の `--hl-*`（theme.ts が、選んだテーマのライト・ダークに合わせて置く）。 */
export const highlightSx = {
  ...Object.fromEntries((Object.keys(SELECTORS) as HighlightName[]).map((k) => [SELECTORS[k], { color: `var(--hl-${k})` }])),
  "& .hljs-emphasis": { fontStyle: "italic" },
  "& .hljs-strong": { fontWeight: 700 },
};
