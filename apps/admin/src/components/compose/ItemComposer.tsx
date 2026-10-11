import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import { EDIT_REQUEST_LIMITS, type EditRequestItemKind } from "@wiki/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useMemo, useState, type MutableRefObject } from "react";
import { buildSuggestion, editorInputFor, type BuiltSuggestion } from "../../lib/blockEdit";
import type { UnitSelection } from "../../lib/blockLines";
import { TOUCH } from "../../theme";
import { SuggestionEditor } from "./SuggestionEditor";

/** 入力欄で書いたもの（「提案に追加する」「指摘を追加する」で、送信前の項目になる） */
export type ComposedItem = { kind: "suggestion"; suggestion: BuiltSuggestion; editorMarkdown: string; reason: string } | { kind: "note"; body: string };

/** 書きかけの中身。本文が新しい版になって場所を失ったとき、呼ぶ側が拾って、書いた内容を捨てずに見せる */
export type ComposerDraft = { kind: EditRequestItemKind; editorMarkdown: string; replacement: string | null; reason: string; body: string };

/** 送信前の項目を直すときの、もとの中身 */
export type ComposerInitial = { kind: EditRequestItemKind; editorMarkdown: string | null; reason: string; body: string };

/**
 * 本文で選んだ範囲のすぐ下に開く入力欄。はじめに、書く内容の種類を選ぶ：
 * - 置き換えを提案する：選んだ範囲が入った小さなエディタで置き換え案を書き、理由（任意）を添える
 * - 指摘だけ書く：置き換え案は持たず、本文（必須。プレーンテキスト）だけを書く
 *
 * 種類を切り替えても、もう片方に書いた内容は残す（小さなエディタは、隠すだけで外さない）。範囲とボタンは、どちらの種類でも共通。
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
  initial: ComposerInitial | null;
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
  const [kind, setKind] = useState<EditRequestItemKind>(initial?.kind ?? "suggestion");
  const [noteBody, setNoteBody] = useState(initial?.body ?? "");
  const note = kind === "note";
  /** 「追加する」を押して分かった、追加できない理由 */
  const [refused, setRefused] = useState<string | null>(null);

  const restored = useMemo(() => (markdown === null ? null : input.restore(markdown)), [input, markdown]);
  const unchanged = restored?.ok === true && restored.replacement === input.unchanged;
  const edited = loaded !== null && markdown !== loaded;
  // 種類を変えただけでは、書きかけにしない（直しているときは、種類を変えたら「直した」）
  const dirty = edited || reason !== (initial?.reason ?? "") || noteBody !== (initial?.body ?? "") || (initial !== null && kind !== initial.kind);
  const tooLong = restored?.ok === true && restored.replacement.length > EDIT_REQUEST_LIMITS.replacement;

  const { onDirtyChange, draft } = props;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  draft.current = markdown === null ? null : { kind, editorMarkdown: markdown, replacement: restored?.ok ? restored.replacement : null, reason, body: noteBody };
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
  const kindId = useId();
  const noteEmpty = noteBody.trim() === "";
  const canAdd = note
    ? !noteEmpty && !(initial !== null && !dirty)
    : !(markdown === null || !restored?.ok || unchanged || tooLong || (initial !== null && !dirty));

  const add = () => {
    if (note) {
      if (!noteEmpty) props.onAdd({ kind: "note", body: noteBody.trim() });
      return;
    }
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
          {initial ? (note ? "指摘を直す" : "提案を直す") : note ? "指摘を書く" : "提案を書く"}
        </Box>
        <Box component="span" sx={{ color: "text.secondary" }}>
          選んだ範囲：{props.rangeLabel}
        </Box>
      </Box>

      {/* 選択肢が2つなので、ラジオボタンで、どちらも見えるようにする */}
      <Box>
        <Box id={kindId} component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.8rem" }}>
          書く内容
        </Box>
        <RadioGroup row aria-labelledby={kindId} value={kind} onChange={(e) => setKind(e.target.value as EditRequestItemKind)} sx={{ columnGap: 1 }}>
          <FormControlLabel value="suggestion" control={<Radio size="small" />} label="置き換えを提案する" slotProps={{ typography: { sx: { fontSize: "0.875rem" } } }} />
          <FormControlLabel value="note" control={<Radio size="small" />} label="指摘だけ書く" slotProps={{ typography: { sx: { fontSize: "0.875rem" } } }} />
        </RadioGroup>
        <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.8rem" }}>
          {note
            ? "直し方は示さず、気づいたこと（根拠が分からない、古いかもしれない、など）だけを伝えます。採用・却下ではなく、「解決済み」で片付きます。"
            : "選んだ範囲を、どう書き換えるかを示します。採用されると、本文がそのとおりに置き換わります。"}
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

      {/* 指摘を書いているあいだも、小さなエディタは外さない（切り替えて戻ったときに、書いた置き換え案が残る） */}
      <Box sx={{ display: note ? "none" : "block" }}>
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

      {note && (
        <TextField
          label="指摘（必須）"
          placeholder="例：この数字の出典が分かりません。いまの値に直したほうがよさそうです"
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          multiline
          minRows={2}
          maxRows={10}
          size="small"
          fullWidth
          required
          autoFocus
          slotProps={{ htmlInput: { maxLength: EDIT_REQUEST_LIMITS.note }, inputLabel: { shrink: true } }}
          helperText={
            noteBody.length > EDIT_REQUEST_LIMITS.note * 0.9
              ? `${noteBody.length.toLocaleString()} / ${EDIT_REQUEST_LIMITS.note.toLocaleString()} 字`
              : noteEmpty
                ? "指摘を書くと、追加できます。書いたままの文字で送られます（Markdown の記法は、そのまま出ます）。"
                : "書いたままの文字で送られます（Markdown の記法は、そのまま出ます）。"
          }
        />
      )}

      <TextField
        sx={{ display: note ? "none" : undefined }}
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
        <Button variant="contained" size="small" disabled={!canAdd} onClick={add} aria-describedby={note ? undefined : messageId}>
          {initial ? "この内容に直す" : note ? "指摘を追加する" : "提案に追加する"}
        </Button>
        <Button variant="outlined" size="small" color="inherit" onClick={props.onClose}>
          {initial ? "直さずに閉じる" : "追加せずに閉じる"}
        </Button>
      </Box>
    </Box>
  );
}
