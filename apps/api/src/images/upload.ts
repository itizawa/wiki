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
  // 大きさが申告されていれば、その大きさの入れ物に直接書く（塊を貯めてから写すと、大きなファイルで使うメモリが倍になる）。
  // 申告より多く来たら、貯めて写す方に切り替える
  const declared = Number(req.headers.get("content-length") ?? 0);
  let direct: Uint8Array | null = declared > 0 ? new Uint8Array(declared) : null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    if (direct && size + value.byteLength <= direct.byteLength) {
      direct.set(value, size);
    } else {
      if (direct) {
        chunks.push(direct.slice(0, size));
        direct = null;
      }
      chunks.push(value);
    }
    size += value.byteLength;
  }
  if (direct) return size === direct.byteLength ? direct : direct.slice(0, size);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
