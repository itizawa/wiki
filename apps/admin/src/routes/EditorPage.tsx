import { History, Search } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { pagePath, type PageDetail, type PageDraft } from "@wiki/shared";
import { diffLines } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { openFindBar } from "../editor/FindBar";
import { sameContent, useDraftAutosave } from "../editor/useDraftAutosave";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { screenLink } from "../lib/wiki";
import { formatDateTime, formatTime } from "../lib/format";
import { textStats } from "../lib/stats";
import { usePersistentState } from "../lib/storage";
import { confirmDialog } from "../components/ConfirmDialog";
import { PageMenu } from "../components/PageMenu";
import { PublishPanel } from "../components/PublishPanel";
import { StarButton } from "../components/StarButton";
import { Tooltip } from "../components/Tooltip";
import { WorkflowPanel } from "../components/WorkflowPanel";
import { TemplatePicker } from "./TemplatePicker";
import { Mono, Muted, Section, StatusChip } from "../components/ui";
import { monoFont } from "../theme";
import { visibilityLabel } from "./PagesPage";

type Draft = { title: string; bodyMd: string };

const VERSION_PANEL_ID = "version-history";

/** タイトルを付けずに作ったページの名前。テンプレートを当てると、テンプレートのタイトルに置き換える */
const UNTITLED = "無題";

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, bodyMd: p.head.bodyMd });

export function EditorPage({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  // 自動保存した下書きは、開くたびにサーバーから読む（前に開いたときのキャッシュは使わない）
  const savedDraft = useQuery({ queryKey: ["draft", pageId], queryFn: () => api.getDraft(pageId), gcTime: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  /** 開いたときに続きから書けるようにした下書き。版として残すか破棄したら消す */
  const [restored, setRestored] = useState<PageDraft | null>(null);
  const [panelOpen, setPanelOpen] = usePersistentState("wiki.editor.panel", false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  // タイトルの下の「版履歴を見る」から：パネルを開き、版履歴の位置までスクロールする
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (!showHistory || !panelOpen) return;
    document.getElementById(VERSION_PANEL_ID)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setShowHistory(false);
  }, [showHistory, panelOpen]);

  const save = useMutation({
    mutationFn: async (content: Draft) => {
      await autosave.settle();
      return api.savePage(pageId, { baseVersionId: baseVersionId!, ...content });
    },
    onSuccess: (p, content) => {
      qc.setQueryData(["page", pageId], p);
      setBaseVersionId(p.headVersionId);
      // 版を作ると、サーバーの下書きは消える
      autosave.markSynced(content);
      setRestored(null);
      void qc.invalidateQueries({ queryKey: ["versions", pageId] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      void qc.invalidateQueries({ queryKey: ["structure"] });
      // 「予約後に編集あり」の表示を更新する
      void qc.invalidateQueries({ queryKey: ["schedule"] });
    },
  });

  const autosave = useDraftAutosave(pageId, draft, baseVersionId, save.isPending);

  // 初回読み込み時だけサーバーの内容で編集を始める（以降はローカルの編集を優先）。
  // 自分の下書きがあればその続きから。下書きのあとに別の版ができていても、いまの head をもとに続ける（上書きになることは画面で知らせる）
  useEffect(() => {
    if (page.data && savedDraft.data && draft === null) {
      const d = savedDraft.data.draft;
      const content = d ? { title: d.title, bodyMd: d.bodyMd } : draftOf(page.data);
      setDraft(content);
      setBaseVersionId(page.data.headVersionId);
      setRestored(d);
      autosave.markSynced(content, d?.updatedAt ?? null);
    }
  }, [page.data, savedDraft.data, draft, autosave]);

  const saved = page.data ? draftOf(page.data) : null;
  /** 版として残していない変更がある */
  const dirty = draft !== null && saved !== null && !sameContent(draft, saved);

  /** 下書きを捨てて、いまの head の内容に戻す */
  const revertToLatest = async () => {
    await autosave.settle();
    await api.discardDraft(pageId);
    const latest = await qc.fetchQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
    setDraft(draftOf(latest));
    setBaseVersionId(latest.headVersionId);
    autosave.markSynced(draftOf(latest));
    setRestored(null);
    save.reset();
  };

  const removed = useRef(false);
  const remove = useMutation({
    mutationFn: () => api.deletePage(pageId),
    onSuccess: async () => {
      removed.current = true;
      await qc.invalidateQueries();
      await navigate(screenLink("/w/$wikiKey"));
    },
  });

  const canSave = draft !== null && draft.title.trim() !== "" && dirty && !save.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (canSave) save.mutate(draft);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, save, draft]);

  // 下書きの保存が済んでいないまま別のページへ移るときは、先に保存する。保存できなかったときだけ確認する（削除後の移動は除く）
  const unsynced = autosave.pending || autosave.saving;
  useBlocker({
    shouldBlockFn: async () =>
      unsynced &&
      !removed.current &&
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
  if (!page.data || !draft) return <Muted sx={{ p: 3 }}>読み込み中…</Muted>;
  const p = page.data;
  // 版を作れなかった・下書きを保存できなかった（どちらも、別の画面で先に版ができたときは読み直すしかない）
  const saveError = save.error ?? autosave.error;

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", minHeight: "100%" }}>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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
          <StarButton pageId={pageId} />
          <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
          <Tooltip title="本文を検索・置換 (⌘F)">
            <IconButton size="small" aria-label="本文を検索・置換" onClick={openFindBar}>
              <Search size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title="いまの内容を版として残します。承認・公開・予約は版に対して行います">
            <Box component="span" sx={{ flexShrink: 0 }}>
              <Button variant="contained" disabled={!canSave} onClick={() => save.mutate(draft)} sx={{ whiteSpace: "nowrap" }}>
                {save.isPending ? "版を作成中…" : "版として残す (⌘S)"}
              </Button>
            </Box>
          </Tooltip>
          <Button variant={panelOpen ? "outlined" : "text"} aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            公開・履歴
          </Button>
          <PageMenu title={draft.title} bodyMd={draft.bodyMd} />
        </Box>

        <Box sx={{ width: "100%", maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4 }}>
          {saveError ? (
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
                stale={restored.baseVersionId !== p.headVersionId}
                onDiscard={async () => {
                  const ok = await confirmDialog({
                    title: "下書きを破棄しますか？",
                    body: "自動保存した下書きを捨てて、最後に残した版の内容に戻します。",
                    confirmLabel: "破棄して最新の版に戻す",
                    cancelLabel: "下書きを続ける",
                    danger: true,
                  });
                  if (ok) await revertToLatest();
                }}
              />
            )
          )}
          <InputBase
            fullWidth
            multiline
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, "") })}
            placeholder="無題"
            inputProps={{ "aria-label": "タイトル" }}
            sx={{ p: 0, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}
          />
          <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, mt: 0.5, mb: 2 }}>
            <Muted>
              最後に残した版 <time dateTime={p.head.createdAt}>{formatDateTime(p.head.createdAt)}</time>
              {dirty && (
                <>
                  {" ・ "}
                  <AutosaveStatus pending={autosave.pending} saving={autosave.saving} failed={autosave.error !== null} savedAt={autosave.savedAt} />
                </>
              )}
            </Muted>
            <Button
              color="inherit"
              startIcon={<History size={18} />}
              onClick={() => {
                setPanelOpen(true);
                setShowHistory(true);
              }}
              sx={{ color: "text.secondary" }}
            >
              版履歴を見る
            </Button>
          </Stack>
          {/* 本文が空のうちは、テンプレートから始められる（サイドバーの「＋」などで作ったばかりのページ） */}
          {draft.bodyMd.trim() === "" && (
            <TemplatePicker
              onApply={(t) => setDraft((d) => (d ? { title: d.title.trim() === "" || d.title === UNTITLED ? t.title : d.title, bodyMd: t.bodyMd } : d))}
            />
          )}
          <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} />
        </Box>
        <EditingStats bodyMd={draft.bodyMd} />
      </Box>

      {panelOpen && (
        <Stack
          component="aside"
          aria-label="公開・履歴"
          spacing={1.5}
          sx={{
            width: { xs: "100%", lg: 340 },
            flexShrink: 0,
            position: { xs: "fixed", lg: "sticky" },
            inset: { xs: "48px 0 0 auto", lg: "auto" },
            maxWidth: { xs: 380, lg: "none" },
            top: { lg: 0 },
            zIndex: 3,
            height: { lg: "100vh" },
            overflowY: "auto",
            p: 1.5,
            borderLeft: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <WorkflowPanel page={p} dirty={dirty} />
          <PublishPanel page={p} dirty={dirty} />
          <VersionPanel
            pageId={pageId}
            headVersionId={p.headVersionId}
            selected={selectedVersion}
            onSelect={setSelectedVersion}
            current={draft}
            onRestore={(v) => setDraft({ ...draft, title: v.title, bodyMd: v.bodyMd })}
          />
          <Section>
            <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
              <Typography variant="subtitle1" component="h3">
                ページ
              </Typography>
              <Muted sx={{ wordBreak: "break-all" }}>
                <Mono>{pagePath(p.id)}</Mono>
              </Muted>
              <Button
                variant="outlined"
                color="error"
                disabled={remove.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `「${p.title}」を削除しますか？`,
                    body: `ツリーからも外れます。${p.publishedVersionId ? "公開中のページなので、公開サイトからも見られなくなります。" : ""}この画面からは元に戻せません。`,
                    confirmLabel: "削除する",
                    cancelLabel: "削除しない",
                    danger: true,
                  });
                  if (ok) remove.mutate();
                }}
              >
                このページを削除…
              </Button>
              {remove.error && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
            </Stack>
          </Section>
        </Stack>
      )}
    </Box>
  );
}

/** 下書きの自動保存の状況。版として残していない変更があるあいだ、最後に残した版の日時の横に出す。 */
function AutosaveStatus(props: { pending: boolean; saving: boolean; failed: boolean; savedAt: string | null }) {
  const text = props.failed
    ? "下書きを保存できませんでした"
    : props.pending || props.saving
      ? "下書きを保存中…"
      : props.savedAt
        ? `下書きを自動保存しました（${formatTime(props.savedAt)}）`
        : "下書きを自動保存しました";
  return (
    <Box component="span" role="status" sx={{ color: props.failed ? "error.main" : undefined }}>
      {text}
    </Box>
  );
}

/** 開いたときに、前回自動保存した下書きの続きから始めたことを知らせる。 */
function RestoredDraftNotice({ draft, stale, onDiscard }: { draft: PageDraft; stale: boolean; onDiscard: () => void }) {
  return (
    <Alert
      severity={stale ? "warning" : "info"}
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" onClick={onDiscard} sx={{ whiteSpace: "nowrap" }}>
          破棄して最新の版に戻す
        </Button>
      }
    >
      {formatDateTime(draft.updatedAt)} に自動保存した下書きの続きを開いています。版として残すまで、公開中の内容や版履歴は変わりません。
      {stale && "この下書きのあとに別の版が作られています。このまま版として残すと、その版の変更は上書きされます。"}
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

/** ツリー上の置き場所（親ページの並び）とタイトル。 */
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

function VersionPanel(props: {
  pageId: string;
  headVersionId: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  current: Draft;
  onRestore: (v: { title: string; bodyMd: string }) => void;
}) {
  const versions = useQuery({ queryKey: ["versions", props.pageId, props.headVersionId], queryFn: () => api.listVersions(props.pageId) });
  const version = useQuery({
    queryKey: ["version", props.pageId, props.selected],
    queryFn: () => api.getVersion(props.pageId, props.selected!),
    enabled: props.selected !== null,
  });

  return (
    <Section id={VERSION_PANEL_ID} sx={{ scrollMarginTop: 12 }}>
      <Typography variant="subtitle1" component="h3">
        版履歴
      </Typography>
      <List dense disablePadding sx={{ maxHeight: 240, overflow: "auto", mx: -1 }}>
        {versions.data?.versions.map((v, i) => (
          <ListItemButton
            key={v.id}
            selected={props.selected === v.id}
            onClick={() => props.onSelect(props.selected === v.id ? null : v.id)}
            sx={{ px: 1, gap: 0.75, borderRadius: 1 }}
          >
            {formatDateTime(v.createdAt)}
            {i === 0 && <StatusChip label="head" />}
            {v.authorType === "ai" && <StatusChip label="AI" />}
          </ListItemButton>
        ))}
      </List>
      {version.data && (
        <Stack spacing={1.5} sx={{ mt: 1.5, minWidth: 0 }}>
          <Muted>この版 → 編集中の内容 の差分</Muted>
          <Diff before={`# ${version.data.title}\n\n${version.data.bodyMd}`} after={`# ${props.current.title}\n\n${props.current.bodyMd}`} />
          <Button variant="outlined" onClick={() => props.onRestore(version.data!)}>
            この版の内容をエディタに戻す
          </Button>
        </Stack>
      )}
    </Section>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  if (parts.every((p) => !p.added && !p.removed)) return <Muted>差分はありません。</Muted>;
  return (
    <Box
      component="pre"
      sx={{ fontFamily: monoFont, fontSize: "0.8rem", maxHeight: 320, overflow: "auto", m: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
    >
      {parts.map((p, i) => (
        <Box
          key={i}
          component="span"
          sx={{ display: "block", bgcolor: p.added ? "diff.added" : p.removed ? "diff.removed" : undefined, color: p.added || p.removed ? undefined : "text.secondary" }}
        >
          {p.value
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => `${p.added ? "+" : p.removed ? "-" : " "} ${line}`)
            .join("\n")}
        </Box>
      ))}
    </Box>
  );
}
