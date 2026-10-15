/**
 * YouTube Data API v3 で、動画を限定公開で投稿する。
 * 出典（2026-10 に確認）：
 * - 動画の投稿（resumable）：https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 * - `videos.insert`：https://developers.google.com/youtube/v3/docs/videos/insert
 * - 割り当て：https://developers.google.com/youtube/v3/determine_quota_cost
 * - 審査（監査）を通していない API のプロジェクトから上げた動画は、非公開に固定される（`videos.insert` の説明）
 */

export type FetchLike = typeof fetch;

export class YouTubeError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** タイトルは 100 文字まで、`<` `>` は使えない。説明は 5000 バイトまで、`<` `>` は使えない */
export function sanitizeTitle(title: string): string {
  const t = title.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  const chars = [...t];
  return chars.length <= 100 ? t : `${chars.slice(0, 99).join("")}…`;
}

export function sanitizeDescription(description: string, maxBytes = 5000): string {
  let d = description.replace(/[<>]/g, "").trim();
  const enc = new TextEncoder();
  while (enc.encode(d).length > maxBytes) d = [...d].slice(0, Math.floor([...d].length * 0.95)).join("");
  return d;
}

export async function getAccessToken(
  cred: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  // 応答の本文は、秘密を含みうるので、メッセージに入れない
  if (!res.ok) throw new YouTubeError(`アクセストークンを取れなかった（${res.status}）。リフレッシュトークンが失効していないか確かめる`, res.status);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new YouTubeError("アクセストークンが応答に無い");
  return body.access_token;
}

/** 限定公開で投稿し、動画の ID を返す。再試行はしない（通っていたのに応答だけ失われたとき、二重に上がるため） */
export async function uploadVideo(
  input: { accessToken: string; video: Uint8Array; title: string; description: string; privacyStatus?: "unlisted" | "private" },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const init = await fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(input.video.byteLength),
    },
    body: JSON.stringify({
      snippet: { title: sanitizeTitle(input.title), description: sanitizeDescription(input.description), categoryId: "22", defaultLanguage: "ja" },
      status: { privacyStatus: input.privacyStatus ?? "unlisted", selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) throw new YouTubeError(`投稿の開始に失敗した（${init.status}）${init.status === 403 ? "。割り当て（quota）か権限を確かめる" : ""}`, init.status);
  const location = init.headers.get("location");
  if (!location || !location.startsWith("https://")) throw new YouTubeError("投稿先の URL が応答に無い");

  const put = await fetchImpl(location, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(input.video.byteLength) },
    body: input.video,
  });
  if (!put.ok) throw new YouTubeError(`動画の送信に失敗した（${put.status}）`, put.status);
  const body = (await put.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new YouTubeError("動画の ID が応答に無い");
  return body.id;
}

/** サムネイルを付ける。電話番号の確認が済んでいないチャンネルでは 403 になる（呼び出す側は、失敗しても投稿は成功として扱う） */
export async function setThumbnail(
  input: { accessToken: string; videoId: string; image: Uint8Array; contentType: "image/png" | "image/jpeg" },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(input.videoId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": input.contentType },
    body: input.image,
  });
  if (!res.ok) throw new YouTubeError(`サムネイルを付けられなかった（${res.status}）`, res.status);
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
