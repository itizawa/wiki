/** Actions の `workflow_dispatch` の入力（Routine「動画を作る」が渡す）を、検査して型にする。 */

export type VideoJob = {
  /** Routine に渡された `runId`。同じ値の実行では、二重に投稿しない */
  runId: string;
  wikiKey: string;
  articlePageId: string;
  scriptPageId: string;
  title: string;
  description: string;
  script: string;
  /** 署名つきの音声の URL（発行から1時間だけ使える。Actions が始まったらすぐ取る） */
  audioUrl: string;
  imageUrls: string[];
  /** 無ければ、タイトルの文字だけの画像を作る */
  thumbnailUrl: string | null;
};

export class JobError extends Error {}

function str(v: unknown, name: string, { max, optional = false }: { max: number; optional?: boolean }): string {
  if (v === undefined || v === null || v === "") {
    if (optional) return "";
    throw new JobError(`入力 ${name} が空`);
  }
  if (typeof v !== "string") throw new JobError(`入力 ${name} が文字列ではない`);
  if (v.length > max) throw new JobError(`入力 ${name} が長すぎる（${max}文字まで）`);
  return v;
}

function httpsUrl(v: string, name: string): string {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new JobError(`入力 ${name} が URL ではない`);
  }
  if (u.protocol !== "https:") throw new JobError(`入力 ${name} が https ではない`);
  return u.toString();
}

/** 画像の URL は、JSON の配列か、1行に1つの文字列で受ける */
export function parseUrlList(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(t);
    } catch {
      throw new JobError("入力 imageUrls が JSON として読めない");
    }
    if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) throw new JobError("入力 imageUrls が文字列の配列ではない");
    return (arr as string[]).map((u) => httpsUrl(u, "imageUrls"));
  }
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((u) => httpsUrl(u, "imageUrls"));
}

export function parseJob(input: unknown): VideoJob {
  if (typeof input !== "object" || input === null) throw new JobError("入力がオブジェクトではない");
  const i = input as Record<string, unknown>;
  const runId = str(i.runId, "runId", { max: 100 });
  // キャッシュのキーとファイル名に使うので、形を絞る
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new JobError("入力 runId は英数字と - _ だけ");
  const thumb = str(i.thumbnailUrl, "thumbnailUrl", { max: 2000, optional: true });
  return {
    runId,
    wikiKey: str(i.wikiKey, "wikiKey", { max: 100 }),
    articlePageId: str(i.articlePageId, "articlePageId", { max: 100 }),
    scriptPageId: str(i.scriptPageId, "scriptPageId", { max: 100 }),
    title: str(i.title, "title", { max: 500 }),
    description: str(i.description, "description", { max: 20_000, optional: true }),
    script: str(i.script, "script", { max: 60_000 }),
    audioUrl: httpsUrl(str(i.audioUrl, "audioUrl", { max: 2000 }), "audioUrl"),
    imageUrls: parseUrlList(str(i.imageUrls, "imageUrls", { max: 20_000, optional: true })),
    thumbnailUrl: thumb ? httpsUrl(thumb, "thumbnailUrl") : null,
  };
}
