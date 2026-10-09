import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { isValidSlug, pagePath, type PageDetail } from "@wiki/shared";
import { diffLines } from "diff";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { PublishPanel } from "../components/PublishPanel";
import { Mono, Muted, Row, Section, StatusChip, WithSidebar } from "../components/ui";
import { monoFont } from "../theme";
import { visibilityLabel } from "./PagesPage";

type Draft = { title: string; slug: string; bodyMd: string };

const draftOf = (p: PageDetail): Draft => ({ title: p.head.title, slug: p.slug, bodyMd: p.head.bodyMd });

export function EditorPage({ pageId }: { pageId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [mode, setMode] = useState<"split" | "edit" | "preview">("split");
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
    (draft.title !== saved.title || draft.slug !== saved.slug || draft.bodyMd !== saved.bodyMd);

  const save = useMutation({
    mutationFn: () =>
      api.savePage(pageId, {
        baseVersionId: baseVersionId!,
        title: draft!.title,
        bodyMd: draft!.bodyMd,
        slug: draft!.slug,
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

  const remove = useMutation({
    mutationFn: () => api.deletePage(pageId),
    onSuccess: async () => {
      await qc.invalidateQueries();
      await navigate({ to: "/" });
    },
  });

  const canSave = draft !== null && draft.title.trim() !== "" && isValidSlug(draft.slug) && dirty && !save.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (canSave) save.mutate();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [canSave, dirty, save]);

  const preview = useMemo(() => (draft ? renderMarkdown(draft.bodyMd) : ""), [draft?.bodyMd]);

  if (page.isPending || !draft) return <Muted>読み込み中…</Muted>;
  if (page.error) return <Alert severity="error">{errorMessage(page.error)}</Alert>;
  const p = page.data;

  return (
    <WithSidebar>
      <Stack spacing={1.5} sx={{ minWidth: 0 }}>
        <Row>
          <TextField
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="タイトル"
            sx={{ flex: 1, minWidth: 0, "& input": { fontSize: "1.4rem", fontWeight: 600 } }}
          />
          <Button variant="contained" size="large" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
          </Button>
        </Row>
        <Row>
          <TextField
            label="slug"
            value={draft.slug}
            error={!isValidSlug(draft.slug)}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            sx={{ flex: 1, minWidth: 0, "& input": { fontFamily: monoFont, fontSize: "0.85rem" } }}
          />
          <Muted component="span">
            <Mono>{pagePath(p.id, draft.slug)}</Mono>
          </Muted>
          <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
        </Row>
        {save.error && (
          <Alert
            severity="error"
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
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, m: typeof mode | null) => m && setMode(m)}>
          <ToggleButton value="split">分割</ToggleButton>
          <ToggleButton value="edit">編集</ToggleButton>
          <ToggleButton value="preview">プレビュー</ToggleButton>
        </ToggleButtonGroup>
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            minHeight: "60vh",
            alignItems: "start",
            gridTemplateColumns: mode === "split" ? { xs: "1fr", md: "1fr 1fr" } : "1fr",
          }}
        >
          {mode !== "preview" && (
            <TextField
              multiline
              fullWidth
              minRows={24}
              value={draft.bodyMd}
              onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })}
              placeholder="Markdownで本文を書く"
              spellCheck={false}
              sx={{ "& textarea": { fontFamily: monoFont, lineHeight: 1.6 } }}
            />
          )}
          {mode !== "edit" && (
            <Paper
              component="article"
              variant="outlined"
              sx={{
                px: 2,
                py: 1.5,
                overflow: "auto",
                lineHeight: 1.7,
                minHeight: "60vh",
                "& pre": { bgcolor: "background.default", p: 1, borderRadius: 1, overflow: "auto" },
                "& a": { color: "primary.main" },
              }}
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          )}
        </Box>
      </Stack>

      <Stack component="aside" spacing={1.5} sx={{ minWidth: 0 }}>
        <VersionPanel
          pageId={pageId}
          headVersionId={p.headVersionId}
          selected={selectedVersion}
          onSelect={setSelectedVersion}
          current={draft}
          onRestore={(v) => setDraft({ ...draft, title: v.title, bodyMd: v.bodyMd })}
        />
        <PublishPanel page={p} dirty={dirty} />
        <Section>
          <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
            <Typography variant="subtitle1" component="h3">
              ページ
            </Typography>
            <Muted>
              <Mono>id: {p.id}</Mono>
            </Muted>
            <Button
              variant="outlined"
              color="error"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`「${p.title}」を削除しますか？（全ツリーから外れます）`)) remove.mutate();
              }}
            >
              削除
            </Button>
            {remove.error && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
          </Stack>
        </Section>
      </Stack>
    </WithSidebar>
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
