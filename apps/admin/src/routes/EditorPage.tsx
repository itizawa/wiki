import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";
import Snackbar from "@mui/material/Snackbar";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink, useBlocker, useNavigate } from "@tanstack/react-router";
import { PAGE_TITLE_MAX, textStats, type AppliedEditRequests, type PageDetail, type PageDraft } from "@wiki/shared";
import { GitPullRequestArrow } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { sameContent, useDraftAutosave } from "../editor/useDraftAutosave";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { caretOnLastLine, enterBodyFromTitle } from "../editor/titleBridge";
import { OutlineButton, OutlineSide, useOutline } from "../editor/Outline";
import { api, ApiError, currentWikiKey, errorMessage } from "../lib/api";
import { usePageTabIcon } from "../lib/tabIcon";
import { useWikis } from "./Layout";
import { editRequestsLink, mergeAppliedEdits, useOpenEditRequestCount } from "../lib/editRequests";
import type { EnsureVersion } from "../components/PublishPanel";
import { forgetRemovedPage, useDeletePage, wasPageRemoved } from "../lib/deletePage";
import { FULL_HEIGHT, NarrowBarActions } from "./WikiLayout";
import { formatDateTime } from "../lib/format";
import { ancestorTitles } from "../lib/ancestorTitles";
import { invalidateAfterNewVersion } from "../lib/invalidateAfterNewVersion";
import { takeJustCreated } from "../lib/newPage";
import { confirmDialog } from "../components/ConfirmDialog";
import { PageAudioSection } from "../components/PageAudio";
import { PageCover, PageCoverPicker, useSetCover } from "../components/PageCover";
import { PageIconButton, PageIconPicker } from "../components/PageIcon";
import { PageMenu } from "../components/PageMenu";
import { PageTagChips } from "../components/PageTagPicker";
import { PublishBadge, PublishMenu } from "../components/PublishMenu";
import { SaveStatus, saveState } from "../components/SaveStatus";
import { StarButton } from "../components/StarButton";
import { VersionHistory } from "../components/VersionHistory";
import { Muted, RouterLink, SkeletonEditor } from "../components/ui";
import { TITLE_TOO_LONG, titleCounter } from "../lib/titleLimit";
import { TemplatePicker } from "./TemplatePicker";
import { useScreenTitle } from "../lib/documentTitle";

type Draft = { title: string; bodyMd: string };

/**
 * 本文の右に目次を置ける、本文の列の幅。これより狭いときは、ヘッダーのボタンから目次を開く。
 * 900px なら、目次（200px）と間と右の余白を除いても本文に約 640px 残り（左右の余白を除いて約 570px）、読みにくくならない。
 * サイドバーを開いたふつうのノート PC（画面の幅 1280px 前後）でも右に出る
 */
const SIDE_OUTLINE = "@container (min-width: 900px)";

/** タイトルを付けずに作ったページの名前。テンプレートを当てると、テンプレートのタイトルに置き換える */
const UNTITLED = "無題";

/** タイトルが空のまま、版を作ろうとしたとき（⌘S・公開・予約）に伝えること */
const TITLE_REQUIRED = "タイトルが空のため、版として残せません。タイトルを入れてください。";

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, bodyMd: p.head.bodyMd });

const ButtonLink = createLink(Button);

const isVersionConflict = (err: unknown) => err instanceof ApiError && err.status === 409 && err.code === "version_conflict";

export function EditorPage({ pageId, historyVersionId }: { pageId: string; historyVersionId: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  // 自動保存した下書きは、開くたびにサーバーから読む（前に開いたときのキャッシュは使わない）
  const wikis = useWikis();
  const wikiFaviconUrl = wikis.data?.wikis.find((w) => w.key === currentWikiKey())?.faviconUrl;
  const savedDraft = useQuery({ queryKey: ["draft", pageId], queryFn: () => api.getDraft(pageId), gcTime: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  // タブのアイコンを、このページの絵文字かタイトルの1文字目にする（入力中のタイトルにも追従する）
  usePageTabIcon(wikiFaviconUrl, draft && page.data ? { title: draft.title, icon: page.data.icon } : null);
  // タブの題も、このページのタイトル（入力中のものに追従。空なら「無題」）にする
  useScreenTitle(draft && page.data ? draft.title : null);
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
  // カバー画像。選ぶ画面は、カバー（付いていなければ「カバーを追加」）の下に出す
  const coverRow = useRef<HTMLDivElement>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const removeCover = useSetCover(pageId);
  const headings = useOutline(editor);
  // 狭い画面（md 未満。WikiLayout が上の帯を置く幅）では、この画面の帯を置かず、操作を上の帯に出して1段にする
  const barBelow = useMediaQuery(useTheme().breakpoints.down("md"));
  // スマホ幅では、さらに操作を「…」メニューにまとめる
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
  const refreshAfterNewVersion = () => invalidateAfterNewVersion(qc, pageId);

  // ワーカーが自分の下書きから版を作っていたら、その版をもとに編集を続ける。編集中の内容は入れ替えない
  // （読み直した head が編集中の内容と同じなら、未反映の変更は無くなる）
  const autosave = useDraftAutosave(pageId, draft, baseVersionId, save.isPending, (headVersionId) => {
    setBase(headVersionId);
    void qc.invalidateQueries({ queryKey: ["page", pageId] });
    refreshAfterNewVersion();
  }, () => {
    // 下書きを保存したら、サイドバーの行のタイトルも自分の下書きのものに取り直す
    void qc.invalidateQueries({ queryKey: ["structure"] });
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
    // 上限を超えたタイトルは版にできない（本文の下書きは保存されている）
    if (draft.title.length > PAGE_TITLE_MAX) {
      titleInput.current?.focus();
      throw new Error(TITLE_TOO_LONG);
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

  // 別の画面で版が先に進んでいて保存できなかった（409）とき、その版が編集リクエストの採用でできたものかを確かめる。
  // 採用でできた版なら、同じ置き換えを手元の内容にかければ、手元を捨てずに続けられる（サーバーも、下書きに同じ置き換えをかけている）
  const saveError = save.error ?? autosave.error;
  const conflicted = isVersionConflict(saveError);
  const applied = useQuery({
    queryKey: ["edit-requests", pageId, "applied", baseVersionId],
    queryFn: () => api.appliedEditRequests(pageId, baseVersionId!),
    enabled: conflicted && baseVersionId !== null,
    gcTime: 0,
    retry: false,
  });
  const accepted = conflicted && applied.data?.mergeable && applied.data.steps.length > 0 ? applied.data : null;
  /** 採用された置き換えをかけた、手元の本文。採用された箇所を手元でも書き換えていて、かけられなければ null */
  const merged = useMemo(() => (accepted && draft ? mergeAppliedEdits(draft.bodyMd, accepted.steps) : null), [accepted, draft]);

  /** 採用された変更を、手元の内容に取り込んで編集を続ける */
  const takeInAccepted = async () => {
    if (!accepted || merged === null || !draft) return;
    await autosave.settle();
    const latest = await qc.fetchQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
    // 確かめたあとに、さらに版が進んでいた。もう一度確かめ直す
    if (latest.headVersionId !== accepted.headVersionId) {
      void applied.refetch();
      return;
    }
    setDraft({ ...draft, bodyMd: merged });
    setBase(latest.headVersionId);
    setRestored(null);
    save.reset();
    // 取り込んだ内容は、まだ保存していない。止まっていた自動保存を再開して、新しい版をもとにした下書きとして保存する
    autosave.resume();
    refreshAfterNewVersion();
    setNotice("採用された変更を、手元の内容に取り込みました");
  };

  // 作った直後のページだけ、タイトルにフォーカスして全部選ぶ（「無題」をそのまま上書きして打てる）。既存のページを開いたときは動かさない
  const ready = draft !== null;
  useEffect(() => {
    if (!ready || !takeJustCreated(pageId)) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [ready, pageId]);

  const openRequests = useOpenEditRequestCount(pageId);

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
    if (loadError instanceof ApiError && loadError.status === 404) {
      return (
        <Alert severity="error" sx={{ m: 3 }}>
          このページは見つかりません。ゴミ箱に入れられたか、URL が違います。
          <Box sx={{ mt: 1 }}>
            <RouterLink to="/w/$wikiKey/pages" params={{ wikiKey: currentWikiKey() }}>
              すべてのページへ
            </RouterLink>
          </Box>
        </Alert>
      );
    }
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {errorMessage(loadError)}
      </Alert>
    );
  }
  if (!page.data || !draft) return <SkeletonEditor />;
  const p = page.data;
  const counter = titleCounter(draft.title.length);
  const outlineTitle = draft.title.trim() || UNTITLED;

  const pageMenu = (
    <PageMenu
      pageId={p.id}
      title={draft.title}
      bodyMd={draft.bodyMd}
      hasIcon={p.icon !== null}
      onPickIcon={() => setIconPickerOpen(true)}
      onKeepVersion={() => void keepVersion()}
      onOpenHistory={() => showVersion(p.headVersionId)}
      openEditRequests={openRequests}
      onDelete={() => void confirmAndDelete({ id: p.id, title: p.title, publishedVersionId: p.publishedVersionId })}
      narrow={narrow}
      page={p}
      dirty={dirty}
      ensureVersion={ensureVersion}
      editor={editor}
      headings={headings}
      onJumpTitle={focusTitleEnd}
    />
  );

  // 本文の下書きの保存の状態。タイトルの誤りは本文の保存を止めない（タイトルの上限は本文の上の表示で伝える）ので、ここには含めない
  const saveStatus = (
    <SaveStatus
      state={saveState(autosave)}
      savedAt={autosave.savedAt}
      // 別の画面で版が進んだ（409）ときは、もう一度試しても保存できない。本文の上の帯の操作で直す
      onRetry={autosave.conflict ? undefined : () => void autosave.flush()}
    />
  );

  // 「…」の手前に並べるボタン（スマホ幅では「…」メニューの中に出す）
  const actions = (
    <>
      <StarButton pageId={pageId} />
      {/* 未対応の編集リクエストがあるあいだだけ、件数つきで出す。0件のときは「…」メニューから開く */}
      {openRequests !== undefined && openRequests > 0 && (
        <ButtonLink {...editRequestsLink(pageId)} size="small" variant="outlined" startIcon={<GitPullRequestArrow size={16} />} sx={{ whiteSpace: "nowrap" }}>
          編集リクエスト {openRequests}
        </ButtonLink>
      )}
      {editor && headings.length > 0 && (
        <Box sx={{ display: "flex", [SIDE_OUTLINE]: { display: "none" } }}>
          <OutlineButton editor={editor} headings={headings} title={outlineTitle} onJumpTitle={focusTitleEnd} />
        </Box>
      )}
      <PublishMenu page={p} dirty={dirty} ensureVersion={ensureVersion} />
    </>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", minHeight: "100%" }}>
      {/* 検索バー（FindBar）をドラッグで動かせるのは、この列の中だけ */}
      <Box
        data-find-bar-bounds
        sx={{ flex: 1, minWidth: 0, minHeight: FULL_HEIGHT, display: "flex", flexDirection: "column", containerType: "inline-size" }}
      >
        {/* ページの操作。スマホ幅では「…」メニューにまとめる。検索・置換はどの幅でも「…」メニューから開く（⌘F でも開く） */}
        {barBelow ? (
          // 狭い画面（md 未満）では、この画面の帯を置かず、上の帯（サイドバーを開くボタンと wiki 名）の右端に出す。パンくずは出さない（タイトルは本文の上で見える）
          <NarrowBarActions>
            {saveStatus}
            {narrow ? <PublishBadge page={p} dirty={dirty} ensureVersion={ensureVersion} /> : actions}
            {pageMenu}
          </NarrowBarActions>
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
              gap: 1,
              px: 2,
              bgcolor: "background.paper",
            }}
          >
            <Breadcrumb pageId={pageId} title={draft.title} />
            {saveStatus}
            {actions}
            {pageMenu}
          </Box>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", columnGap: 4, [SIDE_OUTLINE]: { pr: 4 } }}>
          <Box sx={{ flex: "0 1 780px", minWidth: 0, px: { xs: 2, md: 4 }, pt: 4 }}>
            {titleRequired ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {TITLE_REQUIRED}
              </Alert>
            ) : conflicted && applied.isPending ? (
              // 採用でできた版かどうかを確かめているあいだ。手元の内容は、そのまま残っている
              <Alert severity="info" sx={{ mb: 2 }}>
                別の画面で、このページの新しい版が作られました。手元の内容はそのまま残っています。新しい版の内容を確かめています…
              </Alert>
            ) : accepted ? (
              <AcceptedNotice
                accepted={accepted}
                canTakeIn={merged !== null}
                onTakeIn={() => void takeInAccepted()}
                onReload={async () => {
                  const ok = await confirmDialog({
                    title: "手元の内容を捨てて、最新の版を読み込みますか？",
                    body: "まだ版になっていない手元の変更は失われます。",
                    confirmLabel: "手元の内容を捨てて読み込む",
                    cancelLabel: "編集に戻る",
                    danger: true,
                  });
                  if (ok) await revertToLatest();
                }}
              />
            ) : saveError ? (
              <Alert
                severity="error"
                sx={{ mb: 2 }}
                action={
                  // 競合のときだけ：サーバーの最新版を読み直す（ローカルの編集と下書きは破棄される）。直せる誤りには、編集を捨てるボタンを出さない
                  isVersionConflict(saveError) ? (
                    <Button color="inherit" onClick={() => void revertToLatest()}>
                      最新版を読み込む
                    </Button>
                  ) : undefined
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
            {/* カバー画像は版に入らず、選んだ・外したらすぐに反映する */}
            <Box ref={coverRow}>
              <PageCover
                cover={p.cover}
                onPick={() => setCoverPickerOpen(true)}
                onRemove={() => removeCover.mutate(null)}
                removing={removeCover.isPending}
                error={removeCover.error ? `カバーを外せませんでした：${errorMessage(removeCover.error)}` : null}
              />
            </Box>
            <PageCoverPicker pageId={pageId} cover={p.cover} anchorEl={coverRow.current} open={coverPickerOpen} onClose={() => setCoverPickerOpen(false)} />
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
                inputProps={{
                  "aria-label": "タイトル",
                  "aria-invalid": counter?.kind === "over" || undefined,
                  "aria-describedby": counter ? "title-counter" : undefined,
                }}
                // 本文とひと続きに見えるよう、間は本文の見出しと段落の間と同じにする
                sx={{ p: 0, mb: 1, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}
              />
            </Box>
            {counter && (
              <Typography
                id="title-counter"
                variant="body2"
                role={counter.kind === "over" ? "alert" : "status"}
                sx={{ mb: 1, color: counter.kind === "over" ? "error.main" : "text.secondary", fontWeight: counter.kind === "over" ? 600 : 400 }}
              >
                {counter.text}
                {counter.kind === "over" && " 本文は、このまま保存されます。"}
              </Typography>
            )}
            {/* 付いている管理用タグ。付け外しは「…」メニューの「タグ…」から */}
            <PageTagChips tags={p.tags} />
            <PageIconPicker pageId={pageId} icon={p.icon} anchorEl={titleRow.current} open={iconPickerOpen} onClose={() => setIconPickerOpen(false)} />
            {/* 本文が空のうちは、テンプレートから始められる（サイドバーの「＋」などで作ったばかりのページ） */}
            {draft.bodyMd.trim() === "" && (
              <TemplatePicker
                onApply={(t) => setDraft((d) => (d ? { title: d.title.trim() === "" || d.title === UNTITLED ? t.title : d.title, bodyMd: t.bodyMd } : d))}
              />
            )}
            <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} onEditor={setEditor} onLeaveTop={focusTitleEnd} />
            {/* 動画のナレーションなど、公開前の音声の素材。本文には書かず、公開サイトにも出さない */}
            <PageAudioSection pageId={pageId} bodyMd={draft.bodyMd} />
          </Box>
          {/* 広い画面では、目次を本文の右に置いて、スクロール中も見えるようにする */}
          {/* 見出しが無いときも列は空けておく（見出しを書き足すたびに、本文が左右にずれないように） */}
          <Box sx={{ display: "none", flex: "0 0 200px", pt: 4, [SIDE_OUTLINE]: { display: "block" } }}>
            {editor && headings.length > 0 && <OutlineSide editor={editor} headings={headings} title={outlineTitle} onJumpTitle={focusTitleEnd} />}
          </Box>
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

/**
 * 編集中に、ほかの人（か外部のアプリ）が編集リクエストを採用して、新しい版ができたことを知らせる。
 * 採用された変更を手元の内容に取り込めば、手元を捨てずに続けられる。採用された箇所を手元でも書き換えていたら、取り込めない。
 */
function AcceptedNotice(props: { accepted: AppliedEditRequests; canTakeIn: boolean; onTakeIn: () => void; onReload: () => void }) {
  const names = [...new Set(props.accepted.steps.map((s) => s.acceptedBy?.name).filter((n): n is string => Boolean(n)))];
  const count = props.accepted.steps.reduce((n, s) => n + s.edits.length, 0);
  const who = names.length > 0 ? `${names.join("、")} さんが` : "ほかの人が";
  return (
    <Alert
      severity={props.canTakeIn ? "info" : "warning"}
      // 選ぶまで自動保存が止まるので、本文の下のほうを書いていても見えるよう、画面の上に留める
      sx={{ mb: 2, position: "sticky", top: { xs: 8, md: 56 }, zIndex: 1, boxShadow: 3, "& .MuiAlert-message": { minWidth: 0 } }}
    >
      {who}、このページの編集リクエストの提案を {count} 件採用し、新しい版ができました。
      {props.canTakeIn
        ? "手元の内容はそのまま残っています。採用された変更を取り込むと、手元の内容に同じ置き換えをかけて、そのまま編集を続けられます。"
        : "採用された箇所を手元でも書き換えているため、取り込めません。手元の内容を残したいときは、書き換えた箇所を控えてから、最新の版を読み込んでください。"}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
        {props.canTakeIn && (
          <Button variant="contained" size="small" onClick={props.onTakeIn}>
            採用された変更を取り込む
          </Button>
        )}
        <Button variant="outlined" color="inherit" size="small" onClick={props.onReload}>
          手元の内容を捨てて最新の版を読み込む
        </Button>
      </Box>
    </Alert>
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

/** 本文の文字数と読む時間の目安。広い画面では、書いている間、画面の右下に出し続ける。md 未満では本文の下に置く。 */
function EditingStats({ bodyMd }: { bodyMd: string }) {
  const stats = useMemo(() => textStats(bodyMd), [bodyMd]);
  return (
    <Box
      sx={(t) => ({
        position: "sticky",
        bottom: 0,
        mt: "auto",
        display: "flex",
        justifyContent: "flex-end",
        p: 1,
        pointerEvents: "none",
        // 狭い画面では、書いている行に重なるので固定せず、本文の下の余白に置く
        [t.breakpoints.down("md")]: { position: "static" },
      })}
    >
      <Muted
        aria-live="off"
        sx={{ px: 1, py: 0.25, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "background.paper", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}
      >
        {stats.chars.toLocaleString("ja-JP")}文字・読むのに約{stats.minutes}分
      </Muted>
    </Box>
  );
}

/** ツリー上の置き場所（親ページの並び）とタイトル。 */
function Breadcrumb({ pageId, title }: { pageId: string; title: string }) {
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const ancestors = useMemo(() => ancestorTitles(structure.data, pageId), [structure.data, pageId]);

  return (
    <Muted
      component="div"
      sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
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
