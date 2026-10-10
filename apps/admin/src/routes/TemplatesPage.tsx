import { Plus } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { TEMPLATE_VARIABLES, type PageTemplate } from "@wiki/shared";
import { useEffect, useRef, useState } from "react";
import { confirmDialog } from "../components/ConfirmDialog";
import { Mono, Muted, RouterLink, Row, Section, SkeletonEditor, SkeletonSection } from "../components/ui";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { pageLink, screenLink, templateLink } from "../lib/wiki";
import { FULL_HEIGHT } from "./WikiLayout";

/** テンプレートを消す前の確認。 */
const confirmDelete = (title: string) =>
  confirmDialog({
    title: `テンプレート「${title}」を削除しますか？`,
    body: "このテンプレートから作ったページは消えません。",
    confirmLabel: "削除する",
    cancelLabel: "削除しない",
    danger: true,
  });

/** テンプレートからページを作り、そのページを開く。 */
export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: { templateId: string; title?: string; parentPageId?: string | null }) => api.createPage(input),
    onSuccess: async (page) => {
      void qc.invalidateQueries({ queryKey: ["structure"] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      await navigate(pageLink(page.id));
    },
  });
}

/** 作るときに置き換える変数の説明。 */
export function TemplateVariables() {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {TEMPLATE_VARIABLES.map((v) => (
        <Muted component="li" key={v.name}>
          <Mono>{v.name}</Mono>：{v.label}
        </Muted>
      ))}
    </Box>
  );
}

/** テンプレートの一覧：新しいページのひな形を作る・直す・消す、そこからページを作る。 */
export function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const createPage = useCreateFromTemplate();
  const create = useMutation({
    mutationFn: () => api.createTemplate({ title: "新しいテンプレート", bodyMd: "" }),
    onSuccess: async (t) => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      await navigate(templateLink(t.id));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
  const error = create.error ?? remove.error ?? createPage.error ?? templates.error;

  return (
    <Stack spacing={1.5}>
      <Section>
        <Row sx={{ justifyContent: "space-between", mb: 1 }}>
          <Typography variant="h6" component="h2">
            テンプレート
          </Typography>
          <Button variant="contained" startIcon={<Plus size={18} />} disabled={create.isPending} onClick={() => create.mutate()}>
            新しいテンプレート
          </Button>
        </Row>
        <Muted gutterBottom>
          議事録のように同じ形のページを繰り返し作るときの、ひな形です。新しいページの編集画面で選ぶか、ここから作れます。テンプレートは公開サイトに出ません。エディタの「…」メニューの「テンプレートとして保存」で、いまのページから作ることもできます。
        </Muted>
        <Muted>ページを作るとき、タイトルと本文の次の変数を置き換えます。</Muted>
        <TemplateVariables />
      </Section>

      {error && <Alert severity="error">{errorMessage(error)}</Alert>}
      {/* テンプレートのカード（名前 + 最終更新）の形 */}
      {templates.isPending && [0, 1].map((i) => <SkeletonSection key={i} lines={1} />)}
      {templates.data?.templates.length === 0 && (
        <Section>
          <Muted>テンプレートはまだありません。</Muted>
        </Section>
      )}
      {templates.data?.templates.map((t) => (
        <Section key={t.id}>
          <Row sx={{ justifyContent: "space-between" }}>
            <Box sx={{ minWidth: 0 }}>
              <RouterLink {...templateLink(t.id)} sx={{ fontWeight: 600 }}>
                {t.title}
              </RouterLink>
              <Muted>
                最終更新 <time dateTime={t.updatedAt}>{formatDateTime(t.updatedAt)}</time>
              </Muted>
            </Box>
            <Row>
              <Button variant="outlined" disabled={createPage.isPending} onClick={() => createPage.mutate({ templateId: t.id })}>
                このテンプレートでページを作る
              </Button>
              <Button
                color="error"
                disabled={remove.isPending}
                onClick={async () => {
                  if (await confirmDelete(t.title)) remove.mutate(t.id);
                }}
              >
                削除
              </Button>
            </Row>
          </Row>
        </Section>
      ))}
    </Stack>
  );
}

type Draft = { title: string; bodyMd: string };
const draftOf = (t: PageTemplate): Draft => ({ title: t.title, bodyMd: t.bodyMd });

/** テンプレートの編集画面。ページの編集画面と同じエディタで、版履歴や公開は無い。 */
export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const template = useQuery({ queryKey: ["template", templateId], queryFn: () => api.getTemplate(templateId) });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (template.data && draft === null) setDraft(draftOf(template.data));
  }, [template.data, draft]);

  const saved = template.data ? draftOf(template.data) : null;
  const dirty = draft !== null && saved !== null && (draft.title !== saved.title || draft.bodyMd !== saved.bodyMd);

  const save = useMutation({
    mutationFn: () => api.updateTemplate(templateId, draft!),
    onSuccess: (t) => {
      qc.setQueryData(["template", templateId], t);
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
  const removed = useRef(false);
  const remove = useMutation({
    mutationFn: () => api.deleteTemplate(templateId),
    onSuccess: async () => {
      removed.current = true;
      void qc.invalidateQueries({ queryKey: ["templates"] });
      await navigate(screenLink("/w/$wikiKey/templates"));
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

  useBlocker({
    shouldBlockFn: async () =>
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

  if (template.error) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {errorMessage(template.error)}
      </Alert>
    );
  }
  if (!draft) return <SkeletonEditor />;

  return (
    <Box sx={{ minHeight: FULL_HEIGHT, display: "flex", flexDirection: "column" }}>
      <Box component="header" sx={{ position: "sticky", top: 0, zIndex: 2, height: 48, display: "flex", alignItems: "center", gap: 1, px: 2, bgcolor: "background.paper" }}>
        <Muted component="div" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <RouterLink {...screenLink("/w/$wikiKey/templates")} color="inherit">
            テンプレート
          </RouterLink>
          {" / "}
          <Box component="span" sx={{ color: "text.primary" }}>
            {draft.title || "無題"}
          </Box>
        </Muted>
        <Button
          color="error"
          disabled={remove.isPending}
          onClick={async () => {
            if (await confirmDelete(template.data!.title)) remove.mutate();
          }}
          sx={{ flexShrink: 0 }}
        >
          削除
        </Button>
        <Button variant="contained" disabled={!canSave} onClick={() => save.mutate()} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
        </Button>
      </Box>

      <Box sx={{ width: "100%", maxWidth: 780, mx: "auto", px: { xs: 2, md: 4 }, pt: 4, pb: 6 }}>
        {(save.error ?? remove.error) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(save.error ?? remove.error)}
          </Alert>
        )}
        <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
          <Box sx={{ mb: 0.5 }}>テンプレートです（公開サイトには出ません）。ページを作るとき、次の変数を置き換えます。</Box>
          <TemplateVariables />
        </Alert>
        <InputBase
          fullWidth
          multiline
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, "") })}
          placeholder="テンプレートの名前（作るページのタイトルになります）"
          inputProps={{ "aria-label": "タイトル" }}
          sx={{ p: 0, mb: 2, fontSize: "2.25rem", fontWeight: 700, lineHeight: 1.25 }}
        />
        <MarkdownEditor value={draft.bodyMd} onChange={(bodyMd) => setDraft((d) => (d ? { ...d, bodyMd } : d))} />
      </Box>
    </Box>
  );
}
