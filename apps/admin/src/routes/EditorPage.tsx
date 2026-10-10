import SearchIcon from "@mui/icons-material/Search";
import HistoryIcon from "@mui/icons-material/History";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { pagePath, type PageDetail } from "@wiki/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { openFindBar } from "../editor/FindBar";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { screenLink } from "../lib/wiki";
import { useStars } from "../lib/stars";
import { formatDateTime } from "../lib/format";
import { textStats } from "../lib/stats";
import { confirmDialog } from "../components/ConfirmDialog";
import { PageMenu } from "../components/PageMenu";
import { PublishMenu } from "../components/PublishMenu";
import { Tooltip } from "../components/Tooltip";
import { VersionHistory } from "../components/VersionHistory";
import { Muted } from "../components/ui";

type Draft = { title: string; bodyMd: string };

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, bodyMd: p.head.bodyMd });

export function EditorPage({ pageId, historyVersionId }: { pageId: string; historyVersionId: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);

  // 版履歴の開閉と選んだ版は URL に持つ。開くときだけ履歴に積み（ブラウザの「戻る」で閉じる）、版の選び直しと閉じるときは積まない
  const showVersion = (versionId: string | null, replace = false) =>
    void navigate({ to: ".", search: versionId ? { history: versionId } : {}, replace });

  // 初回読み込み時だけサーバーの内容で下書きを作る（以降はローカルの編集を優先）
  useEffect(() => {
    if (page.data && draft === null) {
      setDraft(draftOf(page.data));
      setBaseVersionId(page.data.headVersionId);
    }
  }, [page.data, draft]);

  const saved = page.data ? draftOf(page.data) : null;
  const dirty =
    draft !== null &&
    saved !== null &&
    (draft.title !== saved.title || draft.bodyMd !== saved.bodyMd);

  const save = useMutation({
    mutationFn: () =>
      api.savePage(pageId, {
        baseVersionId: baseVersionId!,
        title: draft!.title,
        bodyMd: draft!.bodyMd,
      }),
    onSuccess: (p) => {
      qc.setQueryData(["page", pageId], p);
      setBaseVersionId(p.headVersionId);
      void qc.invalidateQueries({ queryKey: ["versions", pageId] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      void qc.invalidateQueries({ queryKey: ["structure"] });
      // 「予約後に編集あり」の表示を更新する
      void qc.invalidateQueries({ queryKey: ["schedule"] });
    },
  });

  const removed = useRef(false);
  const remove = useMutation({
    mutationFn: () => api.deletePage(pageId),
    onSuccess: async () => {
      removed.current = true;
      await qc.invalidateQueries();
      await navigate(screenLink("/w/$wikiKey"));
    },
  });

  const deletePage = async () => {
    const ok = await confirmDialog({
      title: `「${page.data?.title ?? ""}」を削除しますか？`,
      body: `ツリーからも外れます。${page.data?.publishedVersionId ? "公開中のページなので、公開サイトからも見られなくなります。" : ""}この画面からは元に戻せません。`,
      confirmLabel: "削除する",
      cancelLabel: "削除しない",
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const canSave = draft !== null && draft.title.trim() !== "" && dirty && !save.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (canSave) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, save]);

  // 未保存のまま別のページへ移ろうとしたら確認する（削除後の移動は除く）
  useBlocker({
    // 同じページの中の移動（版履歴の開閉）では確かめない
    shouldBlockFn: async ({ current, next }) =>
      current.pathname !== next.pathname &&
      dirty &&
      !removed.current &&
      !(await confirmDialog({
        title: "保存していない変更があります",
        body: "このまま移動すると、保存していない変更は失われます。",
        confirmLabel: "変更を破棄して移動する",
        cancelLabel: "編集に戻る",
        danger: true,
      })),
    enableBeforeUnload: dirty,
  });

  if (page.isPending || !draft) return <Muted sx={{ p: 3 }}>読み込み中…</Muted>;
  if (page.error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {errorMessage(page.error)}
      </Alert>
    );
  }
  const p = page.data;

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
          <Tooltip title="本文を検索・置換 (⌘F)">
            <IconButton size="small" aria-label="本文を検索・置換" onClick={openFindBar}>
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
          </Button>
          <PublishMenu page={p} dirty={dirty} />
          <PageMenu
            title={draft.title}
            bodyMd={draft.bodyMd}
            path={pagePath(p.id)}
            onOpenHistory={() => showVersion(p.headVersionId)}
            onDelete={() => void deletePage()}
          />
        </Box>

        <Box sx={{ width: "100%", maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4 }}>
          {save.error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button
                  color="inherit"
                  onClick={async () => {
                    // 競合時：サーバーの最新版を読み直す（ローカルの編集は破棄される）
                    const latest = await qc.fetchQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
                    setDraft(draftOf(latest));
                    setBaseVersionId(latest.headVersionId);
                    save.reset();
                  }}
                >
                  最新版を読み込む
                </Button>
              }
            >
              {errorMessage(save.error)}
            </Alert>
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
              最終保存 <time dateTime={p.head.createdAt}>{formatDateTime(p.head.createdAt)}</time>
              {dirty && "（保存していない変更があります）"}
            </Muted>
            <Button
              color="inherit"
              startIcon={<HistoryIcon fontSize="small" />}
              onClick={() => showVersion(p.headVersionId)}
              sx={{ color: "text.secondary" }}
            >
              版履歴を見る
            </Button>
          </Stack>
          <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} />
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
      {remove.error && (
        <Alert severity="error" sx={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 4 }}>
          {errorMessage(remove.error)}
        </Alert>
      )}
    </Box>
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

/** スターの付け外し。付いているときは塗りつぶした星にし、ラベルでも状態を伝える。 */
function StarButton({ pageId }: { pageId: string }) {
  const { ids, toggle } = useStars();
  const starred = ids.includes(pageId);
  const label = starred ? "スターを外す" : "スターを付ける（サイドバーの上に出す）";
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} aria-pressed={starred} onClick={() => toggle(pageId)}>
        {starred ? <StarIcon fontSize="small" sx={{ color: "warning.main" }} /> : <StarBorderIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
