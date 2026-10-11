/** ビルドでできた JS のファイル（チャンク）のうち、ここで使う分だけ。Rollup の OutputChunk と同じ名前。 */
export type Chunk = { fileName: string; name: string; isEntry: boolean; imports: string[] };

/**
 * 画面を開いたときに最初に読む JS のファイル。入口のファイルと、そこから静的な import で辿れるもの全部。
 * `import()` で読むもの（画面ごとに分けたファイル）は入らない。
 */
export function firstLoadFiles(chunks: Chunk[]): string[] {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) visit(next);
  };
  for (const c of chunks) if (c.isEntry) visit(c.fileName);
  return [...seen];
}

/**
 * 最初に読む JS に入ってはいけないチャンク（`lazyNames`）が入っていたら、その経路を説明する文を返す。入っていなければ null。
 * 入るのは、どの画面にも出る部品（サイドバー・コマンドメニューなど）がエディタのファイルを静的に import したときと、
 * エディタと共用のライブラリが manualChunks でエディタの側に寄せられたとき。
 */
export function firstLoadProblem(chunks: Chunk[], lazyNames: string[]): string | null {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const first = firstLoadFiles(chunks);
  const leaked = first.filter((file) => lazyNames.includes(byFile.get(file)?.name ?? ""));
  if (leaked.length === 0) return null;
  const importers = first.filter((file) => byFile.get(file)?.imports.some((i) => leaked.includes(i)));
  return (
    `最初に読む JS に ${leaked.join("、")} が入っています（${importers.join("、")} が静的に import しています）。` +
    "どの画面にも出る部品からエディタのファイル（src/editor、@tiptap など）を import していないか、" +
    "共用のライブラリが vite.config.ts の manualChunks で editor に入っていないかを確かめてください。"
  );
}
