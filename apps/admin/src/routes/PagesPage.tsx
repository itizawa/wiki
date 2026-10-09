import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { cx } from "../lib/cx";
import ui from "../styles/ui.module.css";

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
    <div className={ui.stack}>
      <section className={ui.card}>
        <h2>新しいページ</h2>
        <form
          className={ui.row}
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル" className={ui.grow} />
          <button className={ui.buttonPrimary} disabled={!title.trim() || create.isPending}>
            作成してInboxに追加
          </button>
        </form>
        {create.error && <p className={ui.error}>{errorMessage(create.error)}</p>}
      </section>

      <section className={ui.card}>
        <div className={ui.row}>
          <h2 className={ui.grow}>ページ</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" />
        </div>
        {pages.isPending && <p className={ui.muted}>読み込み中…</p>}
        {pages.error && <p className={ui.error}>{errorMessage(pages.error)}</p>}
        {pages.data && pages.data.pages.length === 0 && <p className={ui.muted}>ページはまだありません。</p>}
        <table className={ui.table}>
          <tbody>
            {pages.data?.pages.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to="/pages/$pageId" params={{ pageId: p.id }}>
                    {p.title}
                  </Link>
                </td>
                <td className={cx(ui.muted, ui.small, ui.mono)}>{p.id}</td>
                <td>
                  <span className={cx(ui.badge, ui[p.visibility])}>{visibilityLabel[p.visibility]}</span>
                  {p.origin === "ai_draft" && <span className={ui.badge}>AI下書き</span>}
                </td>
                <td className={cx(ui.muted, ui.small)}>{formatDateTime(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
