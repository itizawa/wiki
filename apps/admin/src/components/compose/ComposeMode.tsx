import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { EDIT_REQUEST_LIMITS, sliceLines } from "@wiki/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "../../lib/api";
import { extendSelection, parseBodyWithLines, selectBetween, selectionForLines, targetForSelection, type BlockUnit, type UnitSelection } from "../../lib/blockLines";
import { inBodyOrder, rangesOverlap, rebaseDraftItems, relocateSelection, toCreateInput, type DraftItem } from "../../lib/editRequestDraft";
import { invalidateEditRequests, itemCountLabel } from "../../lib/editRequests";
import { TOUCH } from "../../theme";
import { confirmDialog } from "../ConfirmDialog";
import { ReviewBody, unitName, type ReviewSelect, type ReviewSlot } from "../ReviewBody";
import { Muted } from "../ui";
import { DraftItemCard } from "./DraftItemCard";
import { ItemComposer, type ComposedItem, type ComposerDraft, type ComposerInitial } from "./ItemComposer";

/** 版と、その本文 */
export type ComposeHead = { versionId: string; bodyMd: string };

/** 入力欄を開いている範囲。`editingId` は、送信前の項目を直しているときの、その項目 */
type Active = { key: number; selection: UnitSelection; editingId: string | null; initial: ComposerInitial | null };

/** 送信前の項目を直すときに、入力欄へ入れ直す中身 */
const initialOf = (item: DraftItem): ComposerInitial =>
  item.kind === "note" ? { kind: "note", editorMarkdown: null, reason: "", body: item.body } : { kind: "suggestion", editorMarkdown: item.editorMarkdown, reason: item.reason, body: "" };

let nextKey = 0;
const newId = () => `draft-${++nextKey}`;
const rangeOf = (s: { startLine: number; endLine: number }) => ({ startLine: s.startLine, endLine: s.endLine });

/**
 * 編集リクエストを出すモード（レビュー画面の中で、「編集リクエストを出す」を押してから、送信するか、やめるまで）。
 *
 * 状態は、どれもこの部品が持つ（サーバーには、送信するまで何も送らない。画面を離れると消える）：
 * - `base`: 提案の行を数える本文（モードに入ったときの最新の版）。ほかの人が版を作ったら、「最新の版に合わせる」で差し替え、
 *   送信前の項目の場所を、元の文面で探し直す（`rebaseDraftItems`）
 * - `items`: 送信前の項目（`DraftItem`。提案と指摘）
 * - `active`: 入力欄を開いている範囲（同時に1つ）
 *
 * 離れる前の確認は、編集画面（`EditorPage`）と同じ `useBlocker`：ほかの画面への移動は画面内の確認、タブを閉じる・再読み込みはブラウザの確認。
 */
export function ComposeMode(props: {
  pageId: string;
  title: string;
  icon: string | null;
  /** いま分かっている最新の版（一覧の読み直しで変わる） */
  head: ComposeHead;
  /** 最新の版を読み直す。読めなければ null */
  reloadHead: () => Promise<ComposeHead | null>;
  /** 送信せずに、モードを終える */
  onQuit: () => void;
  /** 送信できた。`label` は、送った項目の数（「提案 2 件・指摘 1 件」） */
  onSent: (label: string) => void;
}) {
  const { pageId } = props;
  const qc = useQueryClient();
  const [base, setBase] = useState(props.head);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  /** 入力欄に、書きかけがあるか */
  const [dirty, setDirty] = useState(false);
  const composerDraft = useRef<ComposerDraft | null>(null);
  const [comment, setComment] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  /** 選ぶ操作ができなかった理由（本文のすぐ上に出す） */
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  /** 送信が、版が進んでいて止まった */
  const [conflict, setConflict] = useState(false);
  const [catching, setCatching] = useState(false);
  const [caughtUp, setCaughtUp] = useState<{ kept: number; lost: number } | { failed: true } | null>(null);

  const parsed = useMemo(() => parseBodyWithLines(base.bodyMd), [base.bodyMd]);
  const placed = useMemo(() => inBodyOrder(items.filter((i) => i.lost === null)), [items]);
  const lost = useMemo(() => items.filter((i) => i.lost !== null), [items]);
  const behind = conflict || props.head.versionId !== base.versionId;
  const full = placed.length >= EDIT_REQUEST_LIMITS.items;
  const hasPending = items.length > 0 || dirty;
  const pendingText = `送信していない項目（${itemCountLabel(items)}）${dirty ? "と、書きかけの内容" : ""}は、保存されずに消えます。`;
  /** 送る項目の数（「提案 2 件・指摘 1 件」） */
  const placedLabel = itemCountLabel(placed);

  useBlocker({
    // 同じ画面の中の移動では確かめない
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname &&
      hasPending &&
      !(await confirmDialog({
        title: "作成中の編集リクエストを捨てて移動しますか？",
        body: pendingText,
        confirmLabel: "捨てて移動する",
        cancelLabel: "作成に戻る",
        danger: true,
      })),
    enableBeforeUnload: hasPending,
  });

  const quit = async () => {
    if (
      hasPending &&
      !(await confirmDialog({ title: "編集リクエストの作成をやめますか？", body: pendingText, confirmLabel: "やめて、書いた内容を捨てる", cancelLabel: "作成に戻る", danger: true }))
    )
      return;
    props.onQuit();
  };

  const send = useMutation({
    mutationFn: () => api.createEditRequest(pageId, toCreateInput(base.versionId, comment, items)),
    onSuccess: async () => {
      await invalidateEditRequests(qc, pageId);
      props.onSent(placedLabel);
    },
    onError: (err) => {
      if (!(err instanceof ApiError && err.code === "version_conflict")) return;
      // 書いた内容は、そのまま残す。最新の版を読み直してもらい、場所を探し直す
      setConflict(true);
      setSendOpen(false);
      setCaughtUp(null);
      void invalidateEditRequests(qc, pageId);
    },
  });

  /** 最新の版に合わせる：本文を差し替え、送信前の項目と、開いている入力欄の場所を探し直す */
  const catchUp = async () => {
    setCatching(true);
    try {
      const next = props.head.versionId !== base.versionId ? props.head : await props.reloadHead();
      if (!next) return setCaughtUp({ failed: true });
      const nextItems = rebaseDraftItems(items, next.bodyMd);
      let nextActive: Active | null = null;
      if (active) {
        const text = sliceLines(base.bodyMd, active.selection.startLine, active.selection.endLine) ?? "";
        const at = relocateSelection(parseBodyWithLines(next.bodyMd).units, next.bodyMd, active.selection, text);
        const written = composerDraft.current;
        if (at.ok) {
          nextActive = { ...active, selection: at.selection };
        } else if (dirty && !active.editingId && written) {
          // 書きかけの箇所が見つからない：書いた内容を、場所の無い項目として残す（捨てない）
          const common = { id: newId(), selection: { kind: active.selection.kind, ...rangeOf(active.selection) }, selectedText: text, lost: at.reason, ...rangeOf(active.selection), originalText: text };
          if (written.kind === "note") {
            if (written.body.trim() !== "") nextItems.push({ ...common, kind: "note", body: written.body.trim() });
          } else if (written.replacement !== null) {
            nextItems.push({ ...common, kind: "suggestion", replacement: written.replacement, editorMarkdown: written.editorMarkdown, reason: written.reason });
          }
        }
      }
      setBase(next);
      setItems(nextItems);
      setActive(nextActive);
      setConflict(false);
      send.reset();
      setPickNotice(null);
      setCaughtUp({ kept: nextItems.filter((i) => i.lost === null).length, lost: nextItems.filter((i) => i.lost !== null).length });
    } finally {
      setCatching(false);
    }
  };

  const taken = useCallback(
    (range: { startLine: number; endLine: number }, exceptId: string | null) => placed.some((i) => i.id !== exceptId && rangesOverlap(i.selection, range)),
    [placed],
  );

  const open = (selection: UnitSelection, editing: DraftItem | null = null) => {
    setPickNotice(null);
    setDirty(false);
    setActive({ key: ++nextKey, selection, editingId: editing?.id ?? null, initial: editing && initialOf(editing) });
  };

  /** 書きかけがあれば、捨ててよいかを確かめる */
  const mayDiscard = async () =>
    !dirty ||
    (await confirmDialog({ title: "書きかけの内容を捨てますか？", body: "入力欄に書いた内容は、まだ追加していないので消えます。", confirmLabel: "捨てる", cancelLabel: "書き続ける", danger: true }));

  const pick = async (unit: BlockUnit, extend: boolean) => {
    if (active && extend) {
      // Shift を押しながら：いま選んでいる範囲を、そのブロックまで広げる
      if (dirty) return setPickNotice("書き始めたあとは、範囲を変えられません。変えるときは、入力欄をいちど閉じて選び直してください。");
      const first = active.selection.units[0]!;
      const last = active.selection.units[active.selection.units.length - 1]!;
      const wider = [selectBetween(parsed.units, first.path, unit.path), selectBetween(parsed.units, last.path, unit.path)]
        .filter((s): s is UnitSelection => s !== null)
        .sort((a, b) => b.endLine - b.startLine - (a.endLine - a.startLine))[0];
      if (!wider) return;
      if (taken(wider, active.editingId)) return setPickNotice("あいだに、すでに提案か指摘を書いた箇所があるので、そこまでは広げられません。");
      return setActive({ ...active, key: ++nextKey, selection: wider });
    }
    if (!(await mayDiscard())) return;
    const selection = selectBetween(parsed.units, unit.path, unit.path);
    if (selection) open(selection);
  };

  const close = async () => {
    if (!(await mayDiscard())) return;
    setDirty(false);
    setActive(null);
  };

  const add = (composed: ComposedItem) => {
    if (!active) return;
    const { selection } = active;
    const selectedText = sliceLines(base.bodyMd, selection.startLine, selection.endLine) ?? "";
    const common = { id: active.editingId ?? newId(), selection: { kind: selection.kind, ...rangeOf(selection) }, selectedText, lost: null };
    const item: DraftItem =
      composed.kind === "note"
        ? // 指摘は、選んだ範囲をそのまま指す（提案のように、変わった行だけに絞らない）
          { ...common, kind: "note", ...rangeOf(selection), originalText: selectedText, body: composed.body }
        : { ...common, kind: "suggestion", ...composed.suggestion, editorMarkdown: composed.editorMarkdown, reason: composed.reason };
    setItems((list) => (list.some((i) => i.id === item.id) ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item]));
    setDirty(false);
    setActive(null);
    setCaughtUp(null);
  };

  const edit = async (item: DraftItem) => {
    if (!(await mayDiscard())) return;
    const selection = selectionForLines(parsed.units, item.selection.kind, item.selection.startLine, item.selection.endLine);
    if (!selection) return;
    setSendOpen(false);
    open(selection, item);
  };

  const remove = async (item: DraftItem) => {
    if (!(await confirmDialog({ title: `この${item.kind === "note" ? "指摘" : "提案"}を取り除きますか？`, body: "書いた内容は消えます。", confirmLabel: "取り除く", cancelLabel: "残す", danger: true }))) return;
    setItems((list) => list.filter((i) => i.id !== item.id));
    if (active?.editingId === item.id) {
      setDirty(false);
      setActive(null);
    }
  };

  const rangeLabel = (selection: UnitSelection) => {
    const name = unitName(parsed.doc, selection.units[0]!);
    if (selection.units.length === 1) return name;
    return selection.kind === "block" ? `続いた ${selection.units.length} つのブロック` : `続いた ${selection.units.length} つの${name}`;
  };

  const busy = send.isPending || catching;
  // 本文に差し込むもの：送信前の項目と、開いている入力欄
  const slots = useMemo((): ReviewSlot[] => {
    const list: ReviewSlot[] = placed
      .filter((item) => item.id !== active?.editingId)
      .map((item) => {
        const selection = selectionForLines(parsed.units, item.selection.kind, item.selection.startLine, item.selection.endLine);
        return {
          key: item.id,
          ...rangeOf(item.selection),
          target: selection ? targetForSelection(selection) : undefined,
          highlight: true,
          content: <DraftItemCard item={item} disabled={busy} onEdit={() => void edit(item)} onRemove={() => void remove(item)} />,
        };
      });
    if (active) {
      const canExtend = (direction: "up" | "down") => {
        const wider = extendSelection(parsed.units, active.selection, direction);
        return wider !== null && !taken(wider, active.editingId);
      };
      list.push({
        key: `composer-${active.key}`,
        ...rangeOf(active.selection),
        target: targetForSelection(active.selection),
        highlight: true,
        content: (
          <ItemComposer
            key={active.key}
            body={base.bodyMd}
            selection={active.selection}
            rangeLabel={rangeLabel(active.selection)}
            initial={active.initial}
            canExtend={{ up: canExtend("up"), down: canExtend("down") }}
            onExtend={(direction) => {
              const wider = extendSelection(parsed.units, active.selection, direction);
              if (wider) setActive({ ...active, key: ++nextKey, selection: wider });
            }}
            onAdd={add}
            onClose={() => void close()}
            onDirtyChange={setDirty}
            draft={composerDraft}
          />
        ),
      });
    }
    return list;
    // 中の関数は、下の値だけから決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, active, parsed, base, busy, dirty]);

  const select = useMemo(
    (): ReviewSelect => ({
      excluded: [...placed.map((i) => rangeOf(i.selection)), ...(active ? [rangeOf(active.selection)] : [])],
      disabled: busy || (full && !active),
      onPick: (unit, extend) => void pick(unit, extend),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placed, active, busy, full, dirty, parsed],
  );

  const blocked = behind
    ? `${conflict ? "送信できませんでした。" : ""}作成しているあいだに、ほかの人がこのページの新しい版を作りました。書いた内容は、そのまま残っています。「最新の版に合わせる」を押すと、新しい本文を読み込み、書いた箇所を探し直します。`
    : lost.length > 0
      ? "場所が見つからない項目を取り除くと、送信できます。"
      : placed.length === 0
        ? "まだ 0 件です。本文で箇所を選び、提案か指摘を追加すると送信できます。"
        : null;
  const narrow = useMediaQuery(useTheme().breakpoints.down("sm"));

  return (
    <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {/* モード中であることを、画面の上に出し続ける。ここには、ほかの画面へのリンクを置かない */}
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          columnGap: 1.5,
          rowGap: 0.5,
          px: 2,
          py: 0.75,
          minHeight: 48,
          bgcolor: "background.paper",
          borderBottom: 2,
          borderColor: "primary.main",
        }}
      >
        <Chip size="small" color="primary" label="作成中" />
        <Typography component="h1" variant="subtitle1" sx={{ fontWeight: 700 }}>
          編集リクエストを作成中
          <Box component="span" role="status" sx={{ fontWeight: 400 }}>
            {" ・ "}
            {placedLabel}
          </Box>
        </Typography>
        <Box sx={{ ml: "auto", display: "flex", gap: 1, "& .MuiButton-root": { whiteSpace: "nowrap", [TOUCH]: { minHeight: 40 } } }}>
          <Button color="inherit" disabled={busy} onClick={() => void quit()}>
            やめる
          </Button>
          {behind ? (
            // 版が進んだあいだは、送信の代わりに、読み直しを置く（本文をどこまで送っていても、ここから押せる）
            <Button variant="contained" loading={catching} disabled={send.isPending} onClick={() => void catchUp()} aria-describedby="compose-blocked">
              最新の版に合わせる
            </Button>
          ) : (
            <Button variant="contained" disabled={blocked !== null || busy} onClick={() => setSendOpen(true)} aria-describedby={blocked ? "compose-blocked" : undefined}>
              送信する
            </Button>
          )}
        </Box>
        {/* 送信できない理由は、ボタンのそばに、いつも出しておく */}
        {blocked && (
          <Muted id="compose-blocked" role={behind ? "alert" : undefined} sx={{ flexBasis: "100%", textAlign: { sm: "right" }, fontSize: "0.8rem", ...(behind && { color: "text.primary" }) }}>
            {blocked}
          </Muted>
        )}
      </Box>

      <Box sx={{ width: "100%", maxWidth: 780 + 64, mx: "auto", px: { xs: 2, md: 4 }, pt: 3, pb: 12 }}>
        <Stack spacing={3}>
          {caughtUp && "failed" in caughtUp && (
            <Alert severity="error">最新の版を読み込めませんでした。通信の状態を確かめて、もう一度「最新の版に合わせる」を押してください。</Alert>
          )}
          {caughtUp && !("failed" in caughtUp) && !behind && (
            <Alert severity={caughtUp.lost > 0 ? "warning" : "success"} onClose={() => setCaughtUp(null)}>
              最新の版に合わせました。{caughtUp.kept > 0 && `${caughtUp.kept} 件は、同じ箇所に残しました。`}
              {caughtUp.lost > 0 && `${caughtUp.lost} 件は、箇所が書き換えられていて残せませんでした。下に、理由と書いた内容を出しています。`}
            </Alert>
          )}

          {lost.length > 0 && (
            <Stack component="section" spacing={1} aria-labelledby="compose-lost-title">
              <Typography id="compose-lost-title" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                場所が見つからなくなった項目
              </Typography>
              {lost.map((item) => (
                <DraftItemCard key={item.id} item={item} disabled={busy} onRemove={() => void remove(item)} />
              ))}
            </Stack>
          )}

          <Muted>
            直したい箇所・気になる箇所の右にある鉛筆のボタン（か、その箇所そのもの）を押すと、すぐ下に入力欄が開きます。置き換えの提案か、直し方を示さない指摘を書けます。追加したものは送信前の項目になり、「送信する」でまとめて送られます。本文そのものは、提案が採用されるまで変わりません。
          </Muted>
          {full && (
            <Alert severity="info">1回の編集リクエストに入れられる提案と指摘は、合わせて {EDIT_REQUEST_LIMITS.items} 件までです。続きは、送信したあとに、もう一度出してください。</Alert>
          )}

          <Box component="article" aria-label="提案を書く本文">
            <Typography component="h2" sx={{ fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25, mb: 1, overflowWrap: "anywhere" }}>
              {props.icon && (
                <Box component="span" sx={{ mr: 1 }}>
                  {props.icon}
                </Box>
              )}
              {props.title || "無題"}
            </Typography>
            {/* 選べなかった理由は、本文のすぐ上に出す */}
            {pickNotice && (
              <Alert severity="info" onClose={() => setPickNotice(null)} sx={{ mb: 1 }}>
                {pickNotice}
              </Alert>
            )}
            {parsed.units.length === 0 && <Muted>本文がまだ書かれていないので、提案や指摘を書ける箇所がありません。</Muted>}
            <ReviewBody bodyMd={base.bodyMd} parsed={parsed} slots={slots} select={select} />
          </Box>
        </Stack>
      </Box>

      <Dialog open={sendOpen} onClose={() => !send.isPending && setSendOpen(false)} fullWidth maxWidth="sm" fullScreen={narrow} aria-labelledby="compose-send-title">
        <DialogTitle id="compose-send-title">編集リクエストを送信する</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Muted>
              下の{placedLabel}を、1つの編集リクエストとして送信します。送信したあとは書き換えられません（直すときは、取り下げて出し直します）。
            </Muted>
            {dirty && <Alert severity="info">入力欄に書きかけの内容があります。まだ追加していないので、今回の送信には入りません。</Alert>}
            <Stack spacing={1} component="section" aria-label="送信する項目">
              {placed.map((item, i) => (
                <DraftItemCard key={item.id} item={item} index={i + 1} disabled={send.isPending} onEdit={() => void edit(item)} onRemove={() => void remove(item)} />
              ))}
            </Stack>
            <TextField
              label="全体へのひとこと（任意）"
              placeholder="例：用語の表記をそろえる提案です"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              multiline
              minRows={2}
              maxRows={8}
              fullWidth
              disabled={send.isPending}
              slotProps={{ htmlInput: { maxLength: EDIT_REQUEST_LIMITS.comment }, inputLabel: { shrink: true } }}
              helperText={
                comment.length > EDIT_REQUEST_LIMITS.comment * 0.9
                  ? `${comment.length.toLocaleString()} / ${EDIT_REQUEST_LIMITS.comment.toLocaleString()} 字`
                  : "読む人に、全体について伝えたいことがあれば書きます。"
              }
            />
            {send.isError && <Alert severity="error">送信できませんでした。{errorMessage(send.error)}</Alert>}
            {placed.length === 0 && <Alert severity="warning">まだ 0 件です。作成に戻って、提案か指摘を追加してください。</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, "& .MuiButton-root": { [TOUCH]: { minHeight: 40 } } }}>
          <Button disabled={send.isPending} onClick={() => setSendOpen(false)}>
            作成に戻る
          </Button>
          <Button variant="contained" disabled={placed.length === 0} loading={send.isPending} onClick={() => send.mutate()}>
            {placedLabel}を送信する
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
