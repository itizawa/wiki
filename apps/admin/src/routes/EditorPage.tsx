import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { isValidSlug, pagePath, type PageDetail } from "@wiki/shared";
import { diffLines } from "diff";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { PublishPanel } from "../components/PublishPanel";
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

  if (page.isPending || !draft) return <p className="muted">読み込み中…</p>;
  if (page.error) return <p className="error">{errorMessage(page.error)}</p>;
  const p = page.data;

  return (
    <div className="editor-layout">
      <div className="stack">
        <div className="row">
          <input
            className="title-input grow"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="タイトル"
          />
          <button className="button primary" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : dirty ? "保存 (⌘S)" : "保存済み"}
          </button>
        </div>
        <div className="row small">
          <label className="muted">slug</label>
          <input
            className={`mono grow ${isValidSlug(draft.slug) ? "" : "invalid"}`}
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          />
          <span className="muted mono">{pagePath(p.id, draft.slug)}</span>
          <span className={`badge ${p.visibility}`}>{visibilityLabel[p.visibility]}</span>
        </div>
        {save.error && (
          <p className="error">
            {errorMessage(save.error)}{" "}
            <button
              className="link"
              onClick={async () => {
                // 競合時：サーバーの最新版を読み直す（ローカルの編集は破棄される）
                const latest = await qc.fetchQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
                setDraft(draftOf(latest));
                setBaseVersionId(latest.headVersionId);
                save.reset();
              }}
            >
              最新版を読み込む
            </button>
          </p>
        )}
        <div className="tabs">
          {(["split", "edit", "preview"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {{ split: "分割", edit: "編集", preview: "プレビュー" }[m]}
            </button>
          ))}
        </div>
        <div className={`editor-panes ${mode}`}>
          {mode !== "preview" && (
            <textarea
              className="body-input mono"
              value={draft.bodyMd}
              onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })}
              placeholder="Markdownで本文を書く"
              spellCheck={false}
            />
          )}
          {mode !== "edit" && <article className="preview markdown" dangerouslySetInnerHTML={{ __html: preview }} />}
        </div>
      </div>

      <aside className="stack">
        <VersionPanel
          pageId={pageId}
          headVersionId={p.headVersionId}
          selected={selectedVersion}
          onSelect={setSelectedVersion}
          current={draft}
          onRestore={(v) => setDraft({ ...draft, title: v.title, bodyMd: v.bodyMd })}
        />
        <PublishPanel page={p} dirty={dirty} />
        <section className="card">
          <h3>ページ</h3>
          <p className="muted small mono">id: {p.id}</p>
          <button
            className="button danger"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`「${p.title}」を削除しますか？（全ツリーから外れます）`)) remove.mutate();
            }}
          >
            削除
          </button>
          {remove.error && <p className="error">{errorMessage(remove.error)}</p>}
        </section>
      </aside>
    </div>
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
    <section className="card">
      <h3>版履歴</h3>
      <ul className="version-list">
        {versions.data?.versions.map((v, i) => (
          <li key={v.id}>
            <button
              className={`link ${props.selected === v.id ? "active" : ""}`}
              onClick={() => props.onSelect(props.selected === v.id ? null : v.id)}
            >
              {formatDateTime(v.createdAt)}
            </button>
            {i === 0 && <span className="badge">head</span>}
            {v.authorType === "ai" && <span className="badge">AI</span>}
          </li>
        ))}
      </ul>
      {version.data && (
        <div className="stack">
          <p className="small muted">この版 → 編集中の内容 の差分</p>
          <Diff before={`# ${version.data.title}\n\n${version.data.bodyMd}`} after={`# ${props.current.title}\n\n${props.current.bodyMd}`} />
          <button className="button" onClick={() => props.onRestore(version.data!)}>
            この版の内容をエディタに戻す
          </button>
        </div>
      )}
    </section>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  if (parts.every((p) => !p.added && !p.removed)) return <p className="small muted">差分はありません。</p>;
  return (
    <pre className="diff">
      {parts.map((p, i) => (
        <span key={i} className={p.added ? "added" : p.removed ? "removed" : "same"}>
          {p.value
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => `${p.added ? "+" : p.removed ? "-" : " "} ${line}`)
            .join("\n")}
        </span>
      ))}
    </pre>
  );
}
