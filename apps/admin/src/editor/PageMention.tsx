import { FileText, LayoutTemplate, Plus } from "lucide-react";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { pagePath } from "@wiki/shared";
import { api } from "../lib/api";
import { createTrigger, TriggerMenu, useTriggerMatch, type FindTrigger, type TriggerMatch } from "./trigger";

const MAX_ITEMS = 8;
/** 「テンプレートで作ってリンクする」を出すテンプレートの数（新しい順） */
const MAX_TEMPLATES = 3;

/** 行頭か空白の直後の「@」、または「[[」から、カーソルまで。 */
export const findMention: FindTrigger = (before) => {
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { index: before.length - at[1]!.length - 1, query: at[1]! };
  const bracket = /\[\[([^[\]]*)$/.exec(before);
  return bracket ? { index: before.length - bracket[1]!.length - 2, query: bracket[1]! } : null;
};

export const mentionTrigger = createTrigger("pageMention", findMention);

type Item =
  | { kind: "page"; id: string; title: string }
  | { kind: "create"; title: string; template?: { id: string; title: string } };

/** 本文で「@」か「[[」を打つと出る、ほかのページへのリンクの挿入メニュー。 */
export function PageMention({ editor }: { editor: Editor }) {
  const qc = useQueryClient();
  const match = useTriggerMatch(editor, mentionTrigger);
  const q = match?.query.trim() ?? "";
  const pages = useQuery({
    // 検索の画面と同じ検索（タイトルと本文）。タイトルに一致したページが先に来る
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: match !== null,
    placeholderData: keepPreviousData,
  });

  const insertLink = (range: TriggerMatch, page: { id: string; title: string }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent([
        { type: "text", text: page.title, marks: [{ type: "link", attrs: { href: pagePath(page.id) } }] },
        { type: "text", text: " " },
      ])
      .run();

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates, enabled: match !== null });

  const create = useMutation({
    mutationFn: (v: { title: string; templateId?: string; range: TriggerMatch }) => api.createPage({ title: v.title, templateId: v.templateId }),
    onSuccess: (page, v) => {
      insertLink(v.range, page);
      void qc.invalidateQueries({ queryKey: ["structure"] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
    },
  });

  const items: Item[] = (pages.data?.results ?? []).slice(0, MAX_ITEMS).map((p) => ({ kind: "page", id: p.id, title: p.title }));
  // 打った名前のページが無ければ、その名前で新しく作れるようにする
  // テンプレートがあれば、その本文で作ることもできる（タイトルは打った名前）
  if (q !== "" && !items.some((i) => i.title === q)) {
    items.push({ kind: "create", title: q });
    for (const t of (templates.data?.templates ?? []).slice(0, MAX_TEMPLATES)) items.push({ kind: "create", title: q, template: t });
  }

  return (
    <TriggerMenu
      editor={editor}
      trigger={mentionTrigger}
      match={match}
      items={items}
      itemKey={(i) => (i.kind === "page" ? i.id : `create:${i.template?.id ?? ""}`)}
      label="ページへのリンクを挿入"
      emptyText={pages.isPending ? "読み込み中…" : pages.error ? "ページを読み込めませんでした。" : "ページはまだありません。"}
      renderItem={(i) =>
        i.kind === "page" ? (
          <>
            <ListItemIcon>
              <FileText size={18} />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { noWrap: true } }}>{i.title}</ListItemText>
          </>
        ) : i.template ? (
          <>
            <ListItemIcon>
              <LayoutTemplate size={18} />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { noWrap: true } }}>
              「{i.title}」をテンプレート「{i.template.title}」で作ってリンクする
            </ListItemText>
          </>
        ) : (
          <>
            <ListItemIcon>
              <Plus size={18} />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { noWrap: true } }}>「{i.title}」を新しく作ってリンクする</ListItemText>
          </>
        )
      }
      onChoose={(i, range) => {
        if (i.kind === "page") insertLink(range, i);
        else if (!create.isPending) create.mutate({ title: i.title, templateId: i.template?.id, range });
      }}
    />
  );
}
