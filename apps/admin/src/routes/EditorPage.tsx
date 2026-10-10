import { Search } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Snackbar from "@mui/material/Snackbar";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import type { PageDetail, PageDraft } from "@wiki/shared";
import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { openFindBar } from "../editor/FindBar";
import { sameContent, useDraftAutosave } from "../editor/useDraftAutosave";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { caretOnLastLine, enterBodyFromTitle } from "../editor/titleBridge";
import { OutlineButton, OutlineSide, useOutline } from "../editor/Outline";
import { api, errorMessage } from "../lib/api";
import type { EnsureVersion } from "../components/PublishPanel";
import { forgetRemovedPage, useDeletePage, wasPageRemoved } from "../lib/deletePage";
import { FULL_HEIGHT, NarrowBarActions } from "./WikiLayout";
import { formatDateTime } from "../lib/format";
import { textStats } from "../lib/stats";
import { isCounted } from "../lib/views";
import { confirmDialog } from "../components/ConfirmDialog";
import { PageIconButton, PageIconPicker } from "../components/PageIcon";
import { PageMenu } from "../components/PageMenu";
import { PublishMenu } from "../components/PublishMenu";
import { StarButton } from "../components/StarButton";
import { Tooltip } from "../components/Tooltip";
import { VersionHistory } from "../components/VersionHistory";
import { Muted, SkeletonEditor } from "../components/ui";
import { TemplatePicker } from "./TemplatePicker";

type Draft = { title: string; bodyMd: string };

/** 本文の右に目次を置ける、本文の列の幅。これより狭いときは、ヘッダーのボタンから目次を開く。 */
const SIDE_OUTLINE = "@container (min-width: 1100px)";

/** タイトルを付けずに作ったページの名前。テンプレートを当てると、テンプレートのタイトルに置き換える */
const UNTITLED = "無題";

/** タイトルが空のまま、版を作ろうとしたとき（⌘S・公開・予約）に伝えること */
const TITLE_REQUIRED = "タイトルが空のため、版として残せません。タイトルを入れてください。";

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, bodyMd: p.head.bodyMd });

export function EditorPage({ pageId, historyVersionId }: { pageId: string; historyVersionId: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  // 自動保存した下書きは、開くたびにサーバーから読む（前に開いたときのキャッシュは使わない）
  const savedDraft = useQuery({ queryKey: ["draft", pageId], queryFn: () => api.getDraft(pageId), gcTime: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  // 版を作るときは、直前の下書きの保存で分かった head をすぐ使う（state の反映を待たない）
  const baseRef = useRef<string | null>(null);
  const setBase = (id: string) => {
    baseRef.current = id;
    setBaseVersionId(id);
  };
  /** 開いたときに続きから書けるようにした下書きのうち、古い版をもとにしていたもの。版を作るか破棄したら消す */
  const [restored, setRestored] = useState<PageDraft | null>(null);
  /** タイトルが空のまま版を作ろうとした。タイトルを打つまで、その旨を出す */
  const [titleRequired, setTitleRequired] = useState(false);
  /** 「版として残す」の結果の知らせ */
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  // アイコン（絵文字）を選ぶ画面。タイトルのそばのボタンと「…」メニューのどちらから開いても、タイトルの下に出す
  const titleRow = useRef<HTMLDivElement>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const headings = useOutline(editor);
  // スマホ幅では、この画面の帯を置かず、操作を「…」メニューにまとめて上の帯に出す
  const narrow = useMediaQuery(useTheme().breakpoints.down("sm"));

  // 版履歴の開閉と選んだ版は URL に持つ。開くときだけ履歴に積み（ブラウザの「戻る」で閉じる）、版の選び直しと閉じるときは積まない
  const showVersion = (versionId: string | null, replace = false) =>
    void navigate({ to: ".", search: versionId ? { history: versionId } : {}, replace });

  const save = useMutation({
    mutationFn: async (content: Draft) => {
      await autosave.settle();
      return api.savePage(pageId, { baseVersionId: baseRef.current!, ...content });
    },
    onSuccess: (p, content) => {
      qc.setQueryData(["page", pageId], p);
      setBase(p.headVersionId);
      // 版を作ると、サーバーの下書きは消える
      autosave.markSynced(content);
      setRestored(null);
      refreshAfterNewVersion();
    },
  });

  /** 版が増えたあと、版やタイトルを出している所を読み直す */
  const refreshAfterNewVersion = () => {
    void qc.invalidateQueries({ queryKey: ["versions", pageId] });
    void qc.invalidateQueries({ queryKey: ["pages"] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["structure"] });
    // 「予約後に編集あり」の表示を更新する
    void qc.invalidateQueries({ queryKey: ["schedule"] });
  };

  // ワーカーが自分の下書きから版を作っていたら、その版をもとに編集を続ける。編集中の内容は入れ替えない
  // （読み直した head が編集中の内容と同じなら、未反映の変更は無くなる）
  const autosave = useDraftAutosave(pageId, draft, baseVersionId, save.isPending, (headVersionId) => {
    setBase(headVersionId);
    void qc.invalidateQueries({ queryKey: ["page", pageId] });
    refreshAfterNewVersion();
  });

  // 初回読み込み時だけサーバーの内容で編集を始める（以降はローカルの編集を優先）。
  // 自分の下書きがあればその続きから。下書きのあとに別の版ができていても、いまの head をもとに続ける（上書きになることは画面で知らせる）
  useEffect(() => {
    if (page.data && savedDraft.data && draft === null) {
      const d = savedDraft.data.draft;
      const content = d ? { title: d.title, bodyMd: d.bodyMd } : draftOf(page.data);
      setDraft(content);
      setBase(page.data.headVersionId);
      // head をもとにした下書きは、数分で版になるので知らせない。古い版をもとにした下書きだけ、上書きになることを知らせる
      setRestored(d && d.baseVersionId !== page.data.headVersionId ? d : null);
      autosave.markSynced(content, d?.updatedAt ?? null);
    }
  }, [page.data, savedDraft.data, draft, autosave]);

  const saved = page.data ? draftOf(page.data) : null;
  /** まだ版になっていない変更がある（版のタイトルは前後の空白を落として保存するので、落としたもので比べる） */
  const dirty = draft !== null && saved !== null && !sameContent({ ...draft, title: draft.title.trim() }, saved);

  /**
   * いまの内容の版を用意する。まだ版になっていない変更があれば版を作り、無ければいまの head をそのまま使う
   * （head が自動でできた版なら、残す版にする）。公開・予約の前にも呼ぶ。
   */
  const ensureVersion: EnsureVersion = async () => {
    if (!draft || !page.data) throw new Error("page is not loaded");
    // タイトルが空のあいだは版にしない（下書きは保存されている）
    if (draft.title.trim() === "") {
      setTitleRequired(true);
      throw new Error(TITLE_REQUIRED);
    }
    if (!dirty && page.data.head.keep) return page.data;
    return save.mutateAsync(draft);
  };

  /** ⌘S・「…」メニュー・コマンドメニュー：いまの内容を版として残し、結果を知らせる */
  const keepVersion = async () => {
    if (!draft || !page.data || save.isPending) return;
    const alreadyKept = !dirty && page.data.head.keep;
    try {
      await ensureVersion();
      setNotice(alreadyKept ? "いまの内容は、すでに版として残っています" : "いまの内容を版として残しました");
    } catch {
      // 理由は、本文の上のエラーに出す
    }
  };

  /** 本文の先頭から上へ出たら、タイトルの末尾へ移る */
  const focusTitleEnd = () => {
    const el = titleInput.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  const keepVersionRef = useRef(keepVersion);
  keepVersionRef.current = keepVersion;

  /** 下書きを捨てて、いまの head の内容に戻す */
  const revertToLatest = async () => {
    await autosave.settle();
    await api.discardDraft(pageId);
    const latest = await qc.fetchQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
    setDraft(draftOf(latest));
    setBase(latest.headVersionId);
    autosave.markSynced(draftOf(latest));
    setRestored(null);
    save.reset();
  };

  // ゴミ箱に入れる。サイドバーの行の「…」と同じもの（そちらからこのページを入れたときも、下の移動の確認は出さない）
  const { confirmAndDelete, error: removeError } = useDeletePage();
  useEffect(() => forgetRemovedPage(pageId), [pageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void keepVersionRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 下書きの保存が済んでいないまま別のページへ移るときは、先に保存する。保存できなかったときだけ確認する（削除後の移動は除く）
  const unsynced = autosave.pending || autosave.saving;
  useBlocker({
    // 同じページの中の移動（版履歴の開閉）では確かめない
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname &&
      unsynced &&
      !wasPageRemoved(pageId) &&
      !(await autosave.flush()) &&
      !(await confirmDialog({
        title: "下書きを保存できていません",
        body: "このまま移動すると、最後に保存した下書きのあとの変更は失われます。",
        confirmLabel: "変更を破棄して移動する",
        cancelLabel: "編集に戻る",
        danger: true,
      })),
    enableBeforeUnload: unsynced,
  });

  const loadError = page.error ?? savedDraft.error;
  if (loadError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {errorMessage(loadError)}
      </Alert>
    );
  }
  if (!page.data || !draft) return <SkeletonEditor />;
  const p = page.data;
  // 版を作れなかった・下書きを保存できなかった（どちらも、別の画面で先に版ができたときは読み直すしかない）
  const saveError = save.error ?? autosave.error;

  const pageMenu = (
    <PageMenu
      pageId={p.id}
      counted={isCounted(p)}
      title={draft.title}
      bodyMd={draft.bodyMd}
      hasIcon={p.icon !== null}
      onPickIcon={() => setIconPickerOpen(true)}
      onKeepVersion={() => void keepVersion()}
      onOpenHistory={() => showVersion(p.headVersionId)}
      onDelete={() => void confirmAndDelete({ id: p.id, title: p.title, publishedVersionId: p.publishedVersionId })}
      narrow={narrow}
      page={p}
      dirty={dirty}
      ensureVersion={ensureVersion}
      editor={editor}
      headings={headings}
    />
  );

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", minHeight: "100%" }}>
      {/* 検索バー（FindBar）をドラッグで動かせるのは、この列の中だけ */}
      <Box
        data-find-bar-bounds
        sx={{ flex: 1, minWidth: 0, minHeight: FULL_HEIGHT, display: "flex", flexDirection: "column", containerType: "inline-size" }}
      >
        {narrow ? (
          // スマホ幅では、この画面の帯を置かず、「…」を上の帯（サイドバーを開くボタンと wiki 名）の右端に出す
          <NarrowBarActions>{pageMenu}</NarrowBarActions>
        ) : (
          <Box
            component="header"
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              height: 48,
              display: "flex",
              alignItems: "center",
              // 狭い画面ではパンくずを出さないので、ボタンを右に寄せる（広い画面ではパンくずが残りの幅を取る）
              justifyContent: "flex-end",
              gap: 1,
              px: 2,
              bgcolor: "background.paper",
            }}
          >
            <Breadcrumb pageId={pageId} title={draft.title} />
            <StarButton pageId={pageId} />
            <Tooltip title="本文を検索・置換 (⌘F)">
              <IconButton size="small" aria-label="本文を検索・置換" onClick={openFindBar}>
                <Search size={18} />
              </IconButton>
            </Tooltip>
            {editor && headings.length > 0 && (
              <Box sx={{ display: "flex", [SIDE_OUTLINE]: { display: "none" } }}>
                <OutlineButton editor={editor} headings={headings} />
              </Box>
            )}
            <PublishMenu page={p} dirty={dirty} ensureVersion={ensureVersion} />
            {pageMenu}
          </Box>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", columnGap: 4, [SIDE_OUTLINE]: { pr: 4 } }}>
          <Box sx={{ flex: "0 1 780px", minWidth: 0, px: { xs: 2, md: 4 }, pt: 4 }}>
            {titleRequired ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {TITLE_REQUIRED}
              </Alert>
            ) : saveError ? (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                action={
                  // 競合時：サーバーの最新版を読み直す（ローカルの編集と下書きは破棄される）
                  <Button color="inherit" onClick={() => void revertToLatest()}>
                    最新版を読み込む
                  </Button>
                }
              >
                {errorMessage(saveError)}
              </Alert>
            ) : (
              restored && (
                <RestoredDraftNotice
                  draft={restored}
                  onDiscard={async () => {
                    const ok = await confirmDialog({
                      title: "下書きを破棄しますか？",
                      body: "自動保存した下書きを捨てて、最新の版の内容に戻します。",
                      confirmLabel: "破棄して最新の版に戻す",
                      cancelLabel: "下書きを続ける",
                      danger: true,
                    });
                    if (ok) await revertToLatest();
                  }}
                />
              )
            )}
            {/* 下書きは保存されるが、タイトルが空のあいだは版にならない。押す前から分かるよう、タイトルのすぐ上に出しておく */}
            {draft.title.trim() === "" && !titleRequired && <Muted sx={{ mb: 0.5 }}>タイトルを入れると版履歴に残ります</Muted>}
            {/* アイコンは、タイトルと本文の左端を揃えたまま出す（広い画面では左の余白、狭い画面ではタイトルの上） */}
            <Box ref={titleRow} sx={{ position: "relative" }}>
              <PageIconButton icon={p.icon} onClick={() => setIconPickerOpen(true)} />
              <InputBase
                fullWidth
                multiline
                value={draft.title}
                onChange={(e) => {
                  setTitleRequired(false);
                  setDraft({ ...draft, title: e.target.value.replace(/\n/g, "") });
                }}
                onKeyDown={(e) => {
                  if (!editor || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
                  // 日本語の変換を確定する Enter や、候補を選ぶ ↓ では移らない（Safari は確定の Enter を isComposing にしないので、keyCode でも見る）
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter") {
                    // タイトルは分けず、本文の先頭の空の行へ移る
                    e.preventDefault();
                    enterBodyFromTitle(editor, { newLine: true });
                  } else if (e.key === "ArrowDown" && caretOnLastLine(e.currentTarget as HTMLTextAreaElement)) {
                    e.preventDefault();
                    enterBodyFromTitle(editor, { newLine: false });
                  }
                }}
                placeholder="無題"
                inputRef={titleInput}
                inputProps={{ "aria-label": "タイトル" }}
                // 本文とひと続きに見えるよう、間は本文の見出しと段落の間と同じにする
                sx={{ p: 0, mb: 1, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}
              />
            </Box>
            <PageIconPicker pageId={pageId} icon={p.icon} anchorEl={titleRow.current} open={iconPickerOpen} onClose={() => setIconPickerOpen(false)} />
            {/* 本文が空のうちは、テンプレートから始められる（サイドバーの「＋」などで作ったばかりのページ） */}
            {draft.bodyMd.trim() === "" && (
              <TemplatePicker
                onApply={(t) => setDraft((d) => (d ? { title: d.title.trim() === "" || d.title === UNTITLED ? t.title : d.title, bodyMd: t.bodyMd } : d))}
              />
            )}
            <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} onEditor={setEditor} onLeaveTop={focusTitleEnd} />
          </Box>
          {/* 広い画面では、目次を本文の右に置いて、スクロール中も見えるようにする */}
          {editor && headings.length > 0 && (
            <Box sx={{ display: "none", flex: "0 0 200px", pt: 4, [SIDE_OUTLINE]: { display: "block" } }}>
              <OutlineSide editor={editor} headings={headings} />
            </Box>
          )}
        </Box>
        <EditingStats bodyMd={draft.bodyMd} />
      </Box>

      <VersionHistory
        pageId={pageId}
        headVersionId={p.headVersionId}
        selected={historyVersionId}
        onSelect={(id) => showVersion(id, true)}
        onClose={() => showVersion(null, true)}
        current={draft}
        onRestore={(v) => {
          setDraft({ ...draft, title: v.title, bodyMd: v.bodyMd });
          showVersion(null, true);
        }}
      />
      {/* 「…」メニューの知らせと同じ場所（右上）に出す */}
      <Snackbar
        open={notice !== null}
        message={notice}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ mt: 5 }}
      />
      {removeError && (
        <Alert severity="error" sx={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 4 }}>
          {errorMessage(removeError)}
        </Alert>
      )}
    </Box>
  );
}

/** 開いたときに続きから始めた下書きが、古い版をもとにしていたことを知らせる。 */
function RestoredDraftNotice({ draft, onDiscard }: { draft: PageDraft; onDiscard: () => void }) {
  return (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" onClick={onDiscard} sx={{ whiteSpace: "nowrap" }}>
          破棄して最新の版に戻す
        </Button>
      }
    >
      {formatDateTime(draft.updatedAt)} に自動保存した下書きの続きを開いています。この下書きのあとに別の版が作られています。このまま編集を続けると、その版の変更は上書きされます。
    </Alert>
  );
}

/** 本文の文字数と読む時間の目安。書いている間、画面の右下に出し続ける。 */
function EditingStats({ bodyMd }: { bodyMd: string }) {
  const stats = useMemo(() => textStats(bodyMd), [bodyMd]);
  return (
    <Box sx={{ position: "sticky", bottom: 0, mt: "auto", display: "flex", justifyContent: "flex-end", p: 1, pointerEvents: "none" }}>
      <Muted
        aria-live="off"
        sx={{ px: 1, py: 0.25, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "background.paper", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}
      >
        {stats.chars.toLocaleString("ja-JP")}文字・読むのに約{stats.minutes}分
      </Muted>
    </Box>
  );
}

/**
 * ツリー上の置き場所（親ページの並び）とタイトル。
 * 狭い画面（md 未満）では、幅をボタンに回すために出さない。タイトルは本文の上のタイトル欄で見える。
 */
function Breadcrumb({ pageId, title }: { pageId: string; title: string }) {
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const ancestors = useMemo(() => {
    const data = structure.data;
    const nodes = data?.trees[0]?.nodes ?? [];
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const names: string[] = [];
    for (let cur = byId.get(pageId)?.parentNodeId ?? null; cur !== null; cur = byId.get(cur)?.parentNodeId ?? null) {
      const node = byId.get(cur);
      if (!node) break;
      names.unshift(data?.pages[node.pageId]?.title ?? node.pageId);
    }
    return names;
  }, [structure.data, pageId]);

  return (
    <Muted
      component="div"
      sx={{ display: { xs: "none", md: "block" }, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {ancestors.map((name, i) => (
        <span key={i}>{name} / </span>
      ))}
      <Box component="span" sx={{ color: "text.primary" }}>
        {title || "無題"}
      </Box>
    </Muted>
  );
}
