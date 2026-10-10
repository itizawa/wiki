import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { pagePath, type PageDetail } from "@wiki/shared";
import { diffLines } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { usePersistentState } from "../lib/storage";
import { PublishPanel } from "../components/PublishPanel";
import { WorkflowPanel } from "../components/WorkflowPanel";
import { Mono, Muted, Section, StatusChip } from "../components/ui";
import { monoFont } from "../theme";
import { visibilityLabel } from "./PagesPage";

type Draft = { title: string; bodyMd: string };

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, bodyMd: p.head.bodyMd });

export function EditorPage({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = usePersistentState("wiki.editor.panel", false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

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
      await navigate({ to: "/" });
    },
  });

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
    shouldBlockFn: () => dirty && !removed.current && !confirm("保存していない変更があります。破棄して移動しますか？"),
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
      <Box sx={{ flex: 1, minWidth: 0 }}>
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
          <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
          <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
          </Button>
          <Button variant={panelOpen ? "outlined" : "text"} aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
            公開・履歴
          </Button>
        </Box>

        <Box sx={{ maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4 }}>
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
            sx={{ mb: 2, p: 0, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}
          />
          <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} />
        </Box>
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
                onClick={() => {
                  if (confirm(`「${p.title}」を削除しますか？（ツリーからも外れます）`)) remove.mutate();
                }}
              >
                削除
              </Button>
              {remove.error && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
            </Stack>
          </Section>
        </Stack>
      )}
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
    <Section>
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
