/** アップロードした画像の置き場所。本番は Cloudflare R2、手元の開発はディレクトリ、テストはメモリ。 */
export type ImageStore = {
  put(name: string, body: Uint8Array, contentType: string): Promise<void>;
  get(name: string): Promise<{ body: ReadableStream | Uint8Array; contentType: string } | null>;
};

/** R2 のバインディングのうち、ここで使う部分（@cloudflare/workers-types に頼らない） */
export type R2BucketLike = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
};

export function r2ImageStore(bucket: R2BucketLike): ImageStore {
  return {
    async put(name, body, contentType) {
      await bucket.put(name, body, { httpMetadata: { contentType } });
    },
    async get(name) {
      const obj = await bucket.get(name);
      return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream" } : null;
    },
  };
}

export function memoryImageStore(): ImageStore & { files: Map<string, { body: Uint8Array; contentType: string }> } {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    files,
    async put(name, body, contentType) {
      files.set(name, { body, contentType });
    },
    async get(name) {
      return files.get(name) ?? null;
    },
  };
}
