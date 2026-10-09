import { useEffect, useRef, useState } from "react";

type PagefindResult = { url: string; meta: { title?: string }; excerpt: string };
type Pagefind = {
  search: (q: string) => Promise<{ results: { data: () => Promise<PagefindResult> }[] }>;
};

let pagefindPromise: Promise<Pagefind> | undefined;
/** インデックスは初回の検索時に遅延ロードする。 */
function loadPagefind(): Promise<Pagefind> {
  const url = "/pagefind/pagefind.js";
  pagefindPromise ??= import(/* @vite-ignore */ url) as Promise<Pagefind>;
  return pagefindPromise;
}

export default function Search() {
  const [query, setQuery] = useState(() =>
    typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("q") ?? ""),
  );
  const [results, setResults] = useState<PagefindResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    if (!q) {
      setResults(null);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const pagefind = await loadPagefind();
        const search = await pagefind.search(q);
        const data = await Promise.all(search.results.slice(0, 20).map((r) => r.data()));
        if (id === seq.current) {
          setResults(data);
          setError(null);
        }
      } catch {
        if (id === seq.current) setError("検索インデックスを読み込めませんでした（ビルド後に利用できます）。");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="search">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="キーワードで検索"
        aria-label="検索"
        autoFocus
      />
      {error && <p className="muted">{error}</p>}
      {results && results.length === 0 && <p className="muted">「{query}」に一致する記事はありませんでした。</p>}
      {results && results.length > 0 && (
        <ol className="search-results">
          {results.map((r) => (
            <li key={r.url}>
              <a href={r.url}>{r.meta.title ?? r.url}</a>
              {/* excerpt は Pagefind が自サイトの本文から作るハイライト付きHTML */}
              <p dangerouslySetInnerHTML={{ __html: r.excerpt }} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
