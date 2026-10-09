import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";

export function PagesPage() {
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const pages = useQuery({ queryKey: ["pages", q], queryFn: () => api.listPages(q) });
  const create = useMutation({
    mutationFn: () => api.createPage({ title }),
    onSuccess: (page) => navigate({ to: "/pages/$pageId", params: { pageId: page.id } }),
  });

  return (
    <div className="stack">
      <section className="card">
        <h2>新しいページ</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル" className="grow" />
          <button className="button primary" disabled={!title.trim() || create.isPending}>
            作成してInboxに追加
          </button>
        </form>
        {create.error && <p className="error">{errorMessage(create.error)}</p>}
      </section>

      <section className="card">
        <div className="row">
          <h2 className="grow">ページ</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" />
        </div>
        {pages.isPending && <p className="muted">読み込み中…</p>}
        {pages.error && <p className="error">{errorMessage(pages.error)}</p>}
        {pages.data && pages.data.pages.length === 0 && <p className="muted">ページはまだありません。</p>}
        <table className="table">
          <tbody>
            {pages.data?.pages.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to="/pages/$pageId" params={{ pageId: p.id }}>
                    {p.title}
                  </Link>
                </td>
                <td className="muted small mono">{p.id}</td>
                <td>
                  <span className={`badge ${p.visibility}`}>{visibilityLabel[p.visibility]}</span>
                  {p.origin === "ai_draft" && <span className="badge">AI下書き</span>}
                </td>
                <td className="muted small">{formatDateTime(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
