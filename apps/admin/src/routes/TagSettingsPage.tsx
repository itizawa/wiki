import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TAG_NAME_MAX, tagNameSchema, type WikiTag } from "@wiki/shared";
import { useState } from "react";
import { ConfirmHost, confirmDialog } from "../components/ConfirmDialog";
import { DataList, type ColumnLayout, type DataListColumn } from "../components/DataList";
import { HelpHeading } from "../components/HelpTip";
import { Field, RouterLink, Row, Section } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { invalidateAfterTagChange } from "../lib/invalidatePageLists";
import { tagPagesLink, useWiki } from "../lib/wiki";
import { actionsRowSx } from "./WikisPage";

/**
 * タグの一覧の、列の幅と狭い幅（md 未満）での扱い。狭い幅では、操作を行の下に積む（横に送らなくても押せる）。
 * 付いているページの数は隠す（行を押せば、そのタグが付いたページの一覧が開く）。
 */
export const tagColumnLayout = {
  name: { width: "minmax(140px, 1fr)" },
  pages: { width: "max-content", narrow: "hide" },
  actions: { width: "max-content", narrow: "stack" },
} satisfies ColumnLayout;

/** 入力したタグ名の誤り（空・長すぎ）。誤りが無ければ null。API に送る前に、入力欄の下へその場で出す。 */
export function tagNameProblem(name: string): string | null {
  const parsed = tagNameSchema.safeParse(name);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "タグ名を確かめてください");
}

/** 削除の確認に出す、付いているページ数の文。 */
export function deleteTagBody(pageCount: number): string {
  const pages = pageCount === 0 ? "どのページにも付いていません。" : `付いている ${pageCount} ページから外れます。`;
  return `${pages}元に戻せません。必要なら、あとからもう一度作ってください。`;
}

/**
 * 「設定」の「タグ管理」タブ（`/w/{key}/settings/tags`）：管理用タグの一覧と、作る・名前を変える・削除。管理者だけ。
 */
export function TagSettingsPage() {
  const { role } = useWiki();

  return (
    <Stack spacing={1.5}>
      <ConfirmHost />
      {role !== "admin" ? <Alert severity="info">タグの管理は、この wiki の管理者だけが行えます。</Alert> : <TagsSection />}
    </Stack>
  );
}

const TAGS_KEY = ["tags"];
const ROW_HEIGHT = 56;

/** 「タグ」の節：管理用タグの一覧と、作る・名前を変える・削除。タグはページに付けるラベルで、公開サイトには出ない。 */
function TagsSection() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: TAGS_KEY, queryFn: api.listTags });
  const [renaming, setRenaming] = useState<WikiTag | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (t: WikiTag) => api.deleteTag(t.id),
    onSuccess: (_, t) => {
      invalidateAfterTagChange(qc);
      setDone(`タグ「${t.name}」を削除しました。`);
    },
  });

  const askDelete = async (t: WikiTag) => {
    const ok = await confirmDialog({
      title: `タグ「${t.name}」を削除しますか？`,
      body: deleteTagBody(t.pageCount),
      confirmLabel: "削除する",
      cancelLabel: "削除せずに戻る",
      danger: true,
    });
    if (ok) {
      setDone(null);
      remove.reset();
      remove.mutate(t);
    }
  };

  const columns: DataListColumn<WikiTag>[] = [
    { key: "name", header: "名前", ...tagColumnLayout.name, sx: { overflowWrap: "anywhere" }, render: (t) => (
        // 行のどこを押しても移れるが、Tab・Enter・新しいタブで開く操作は、この本物のリンクが受け持つ
        <RouterLink {...tagPagesLink(t.id)} sx={{ fontWeight: 600 }}>
          {t.name}
        </RouterLink>
      ),
    },
    { key: "pages", header: "付いているページ", ...tagColumnLayout.pages, sx: { whiteSpace: "nowrap" }, render: (t) => `${t.pageCount} ページ` },
    {
      key: "actions",
      header: "操作",
      ...tagColumnLayout.actions,
      render: (t) => (
        // 取り返しのつかない操作（削除）は、ほかの操作から離して置く
        <Row sx={actionsRowSx}>
          <Button variant="outlined" aria-label={`タグ「${t.name}」の名前を変える`} onClick={() => setRenaming(t)} sx={{ whiteSpace: "nowrap" }}>
            名前を変える
          </Button>
          <Button variant="outlined" color="error" aria-label={`タグ「${t.name}」を削除`} disabled={remove.isPending} onClick={() => askDelete(t)} sx={{ ml: { md: 3 }, whiteSpace: "nowrap" }}>
            削除
          </Button>
        </Row>
      ),
    },
  ];

  return (
    <Section>
      <HelpHeading
        variant="subtitle1"
        component="h2"
        sx={{ mb: 1 }}
        help="ページに付ける、管理のためのラベルです。公開サイトには出ません。ここで作ったタグを、編集画面の「…」メニューやサイドバーの行メニューの「タグ…」から、ページに付け外しします。タグ名は、同じ wiki の中で重ならないようにします（大文字と小文字は区別します）。"
      >
        タグ
      </HelpHeading>
      <CreateTagForm onCreated={(name) => setDone(`タグ「${name}」を作りました。`)} />
      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 1 }}>
          {done}
        </Alert>
      )}
      {remove.error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          削除できませんでした：{errorMessage(remove.error)}
        </Alert>
      )}
      <DataList
        label="タグ"
        columns={columns}
        rows={list.data?.tags}
        rowKey={(t) => t.id}
        rowLink={(t) => tagPagesLink(t.id)}
        error={list.error}
        empty="タグはまだありません。上の入力欄から作ってください。"
        rowHeight={ROW_HEIGHT}
        skeletonRows={3}
      />
      {renaming && (
        <RenameTagDialog
          tag={renaming}
          onClose={() => setRenaming(null)}
          onDone={(name) => {
            setRenaming(null);
            setDone(`タグ名を「${name}」に変えました。`);
          }}
        />
      )}
    </Section>
  );
}

/** 一覧の上の「タグを作る」。誤り（空・重複）は、入力欄の下にその場で出す。 */
function CreateTagForm({ onCreated }: { onCreated: (name: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  // 押したあとに初めて、入力の誤りを出す（打っている途中に赤くしない）
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: (n: string) => api.createTag(n),
    onSuccess: (tag) => {
      invalidateAfterTagChange(qc);
      setName("");
      setSubmitted(false);
      onCreated(tag.name);
    },
  });
  const problem = submitted ? tagNameProblem(name) : null;
  const message = problem ?? (create.error ? errorMessage(create.error) : null);

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (tagNameProblem(name) === null && !create.isPending) create.mutate(name.trim());
      }}
      sx={{ display: "flex", alignItems: "flex-start", gap: 1, flexWrap: "wrap", mb: 1.5 }}
    >
      <Field
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          create.reset();
        }}
        error={message !== null}
        helperText={message ?? " "}
        slotProps={{ htmlInput: { maxLength: TAG_NAME_MAX + 20, autoComplete: "off", "aria-label": "新しいタグの名前" } }}
        placeholder="例：要レビュー"
        sx={{ width: 280, maxWidth: "100%" }}
      />
      <Button type="submit" variant="contained" disabled={create.isPending} sx={{ whiteSpace: "nowrap", mt: "1px", height: 40 }}>
        {create.isPending ? "作っています…" : "タグを作る"}
      </Button>
    </Box>
  );
}

/** 「名前を変える」のダイアログ。誤り（空・重複）は、入力欄の下に出す。 */
function RenameTagDialog({ tag, onClose, onDone }: { tag: WikiTag; onClose: () => void; onDone: (name: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [submitted, setSubmitted] = useState(false);
  const rename = useMutation({
    mutationFn: (n: string) => api.renameTag(tag.id, n),
    onSuccess: (saved) => {
      invalidateAfterTagChange(qc);
      onDone(saved.name);
    },
  });
  const problem = submitted ? tagNameProblem(name) : null;
  const message = problem ?? (rename.error ? errorMessage(rename.error) : null);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="rename-tag-title">
      <Box
        component="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (tagNameProblem(name) === null && !rename.isPending) rename.mutate(name.trim());
        }}
      >
        <DialogTitle id="rename-tag-title">タグ「{tag.name}」の名前を変える</DialogTitle>
        <DialogContent>
          <Field
            label="タグの名前"
            autoFocus
            fullWidth
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              rename.reset();
            }}
            error={message !== null}
            helperText={message ?? " "}
            slotProps={{ htmlInput: { maxLength: TAG_NAME_MAX + 20, autoComplete: "off" } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>変えずに閉じる</Button>
          <Button type="submit" variant="contained" disabled={rename.isPending}>
            {rename.isPending ? "保存しています…" : "名前を変える"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
