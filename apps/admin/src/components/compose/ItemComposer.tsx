import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { EDIT_REQUEST_LIMITS } from "@wiki/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useMemo, useState, type MutableRefObject } from "react";
import { buildSuggestion, editorInputFor, type BuiltSuggestion } from "../../lib/blockEdit";
import type { UnitSelection } from "../../lib/blockLines";
import { TOUCH } from "../../theme";
import { SuggestionEditor } from "./SuggestionEditor";

/** 入力欄で書いたもの（「提案に追加する」で、送信前の項目になる） */
export type ComposedItem = { kind: "suggestion"; suggestion: BuiltSuggestion; editorMarkdown: string; reason: string };

/** 書きかけの中身。本文が新しい版になって場所を失ったとき、呼ぶ側が拾って、書いた内容を捨てずに見せる */
export type ComposerDraft = { editorMarkdown: string; replacement: string | null; reason: string };

/**
 * 本文で選んだ範囲のすぐ下に開く入力欄。選んだ範囲が入った小さなエディタで置き換え案を書き、理由（任意）を添えて「提案に追加する」。
 *
 * 項目の種類（いまは提案だけ）を足すときは、ここに種類の選択（ラジオボタン）を置き、種類ごとの入力（提案なら小さなエディタ）を切り替える。
 * 範囲・理由・ボタンは、種類が増えても共通。
 *
 * 本文（`.tiptap`）の中に差し込むので、本文の見た目が当たる要素（p / ul など）は、小さなエディタの中のほかでは使わない。
 */
export function ItemComposer(props: {
  /** 選んだ範囲を数えた本文（基準の版） */
  body: string;
  selection: UnitSelection;
  /** 選んだ範囲の呼び方（「段落」「3つのブロック」など） */
  rangeLabel: string;
  /** 送信前の項目を直すときの、もとの中身。新しく書くときは null */
  initial: { editorMarkdown: string; reason: string } | null;
  /** 範囲を広げられるか（広げた先に、ほかの提案があるときも広げられない） */
  canExtend: { up: boolean; down: boolean };
  onExtend: (direction: "up" | "down") => void;
  onAdd: (item: ComposedItem) => void;
  /** 追加せずに閉じる */
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  draft: MutableRefObject<ComposerDraft | null>;
}) {
  const { selection, initial } = props;
  const input = useMemo(() => editorInputFor(props.body, selection), [props.body, selection.kind, selection.startLine, selection.endLine]); // eslint-disable-line react-hooks/exhaustive-deps
  /** エディタが読み込んだ直後に書き出した Markdown。これと違えば、書き換えている */
  const [loaded, setLoaded] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [reason, setReason] = useState(initial?.reason ?? "");
  /** 「追加する」を押して分かった、追加できない理由 */
  const [refused, setRefused] = useState<string | null>(null);

  const restored = useMemo(() => (markdown === null ? null : input.restore(markdown)), [input, markdown]);
  const unchanged = restored?.ok === true && restored.replacement === input.unchanged;
  const edited = loaded !== null && markdown !== loaded;
  const dirty = edited || reason !== (initial?.reason ?? "");
  const tooLong = restored?.ok === true && restored.replacement.length > EDIT_REQUEST_LIMITS.replacement;

  const { onDirtyChange, draft } = props;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  draft.current = markdown === null ? null : { editorMarkdown: markdown, replacement: restored?.ok ? restored.replacement : null, reason };
  useEffect(() => () => void (draft.current = null), [draft]);

  // 追加できない理由は、入力欄のすぐ下に、書いているあいだから出す
  const problem = restored && !restored.ok ? restored.reason : tooLong ? `置き換え案が長すぎます（${EDIT_REQUEST_LIMITS.replacement.toLocaleString()} 字まで）。範囲を分けて提案してください。` : refused;
  const hint = unchanged
    ? initial
      ? "元の文面と同じです。書き換えるか、この提案を取り除いてください。"
      : "まだ書き換えていません。上の文面を直すと、提案に追加できます。消す提案にするときは、中身をすべて消します。"
    : null;
  const messageId = useId();
  const titleId = useId();

  const add = () => {
    if (!restored?.ok || markdown === null) return;
    const built = buildSuggestion(props.body, selection, restored.replacement);
    if (!built.ok) return setRefused(built.reason);
    props.onAdd({ kind: "suggestion", suggestion: built.suggestion, editorMarkdown: markdown, reason: reason.trim() });
  };

  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{
        // 本文の中（リストの中など）に出しても、まわりの文字の見た目を引き継がない
        color: "text.primary",
        fontSize: "0.875rem",
        fontWeight: 400,
        fontStyle: "normal",
        lineHeight: 1.6,
        textAlign: "left",
        whiteSpace: "normal",
        cursor: "auto",
        bgcolor: "background.paper",
        border: 1,
        borderColor: "primary.main",
        borderLeft: 3,
        borderLeftColor: "primary.main",
        borderRadius: 1,
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        minWidth: 0,
        "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } },
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.5 }}>
        <Box id={titleId} component="span" sx={{ fontWeight: 600 }}>
          {initial ? "提案を直す" : "提案を書く"}
        </Box>
        <Box component="span" sx={{ color: "text.secondary" }}>
          選んだ範囲：{props.rangeLabel}
        </Box>
      </Box>

      {(props.canExtend.up || props.canExtend.down) &&
        (dirty ? (
          // 書き始めたら、ボタンは片付ける（押せないボタンを並べない）。変えられない理由だけを残す
          <Box sx={{ color: "text.secondary", fontSize: "0.8rem" }}>書き始めたあとは、範囲を変えられません。変えるときは、いちど閉じて選び直します。</Box>
        ) : (
          <Box role="group" aria-label="範囲を広げる" sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            {props.canExtend.up && (
              <Button size="small" variant="outlined" color="inherit" startIcon={<ArrowUp size={16} aria-hidden />} onClick={() => props.onExtend("up")}>
                上へ範囲を広げる
              </Button>
            )}
            {props.canExtend.down && (
              <Button size="small" variant="outlined" color="inherit" startIcon={<ArrowDown size={16} aria-hidden />} onClick={() => props.onExtend("down")}>
                下へ範囲を広げる
              </Button>
            )}
            <Box component="span" sx={{ color: "text.secondary", fontSize: "0.8rem", flexBasis: { xs: "100%", sm: "auto" } }}>
              続いたブロックをまとめて直すときは、書き始める前に広げます。
            </Box>
          </Box>
        ))}

      <Box>
        <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.8rem", mb: 0.5 }}>
          置き換え案（この内容に書き換える提案になります）
        </Box>
        <SuggestionEditor
          initial={initial?.editorMarkdown ?? input.markdown}
          label="置き換え案"
          describedBy={messageId}
          invalid={Boolean(problem)}
          onReady={(md) => {
            setLoaded(md);
            setMarkdown(md);
          }}
          onChange={(md) => {
            setMarkdown(md);
            setRefused(null);
          }}
        />
        <Box id={messageId} role="status" sx={{ mt: 0.5, minHeight: "1.3em", fontSize: "0.8rem", color: problem ? "error.main" : "text.secondary" }}>
          {problem ?? hint}
        </Box>
      </Box>

      <TextField
        label="理由（任意）"
        placeholder="例：ほかのページと表記をそろえるため"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        multiline
        minRows={1}
        maxRows={6}
        size="small"
        fullWidth
        slotProps={{ htmlInput: { maxLength: EDIT_REQUEST_LIMITS.reason }, inputLabel: { shrink: true } }}
        helperText={reason.length > EDIT_REQUEST_LIMITS.reason * 0.9 ? `${reason.length.toLocaleString()} / ${EDIT_REQUEST_LIMITS.reason.toLocaleString()} 字` : undefined}
      />

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <Button variant="contained" size="small" disabled={markdown === null || !restored?.ok || unchanged || tooLong || (initial !== null && !dirty)} onClick={add} aria-describedby={messageId}>
          {initial ? "この内容に直す" : "提案に追加する"}
        </Button>
        <Button variant="outlined" size="small" color="inherit" onClick={props.onClose}>
          {initial ? "直さずに閉じる" : "追加せずに閉じる"}
        </Button>
      </Box>
    </Box>
  );
}
