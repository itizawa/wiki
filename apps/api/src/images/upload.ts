import type { HttpError } from "../errors";

/**
 * アップロードの本文を、上限まで読む。上限を超えたら、残りを読まずに `tooLarge()` を投げる。
 * `content-length` が無い（chunked）ものも、全体をメモリに載せる前に打ち切る。
 * 上限とエラーの中身は経路ごとに違うので、呼ぶ側から渡す。
 */
export async function readBodyUpTo(req: Request, maxBytes: number, tooLarge: () => HttpError): Promise<Uint8Array> {
  // 中身を読む前に、申告された大きさで断る
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
