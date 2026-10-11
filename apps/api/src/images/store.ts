/** 置いてある画像1枚。`uploaded` は置いた時刻 */
export type StoredImage = { name: string; uploaded: Date };

/** アップロードした画像の置き場所。本番は Cloudflare R2、手元の開発はディレクトリ、テストはメモリ。 */
export type ImageStore = {
  put(name: string, body: Uint8Array, contentType: string): Promise<void>;
  get(name: string): Promise<{ body: ReadableStream | Uint8Array; contentType: string } | null>;
  /**
   * 置いてある画像を、名前の順に `limit` 件まで返す。続きがあれば `cursor` が入り、それを渡すと続きを返す。
   * 参照されていない画像の掃除（`images/cleanup.ts`）が使う
   */
  list(opts: { limit: number; cursor?: string }): Promise<{ objects: StoredImage[]; cursor: string | null }>;
  /** 画像を消す。無い名前は何もしない。**消した画像は戻せない** */
  delete(names: string[]): Promise<void>;
};

/** R2 が1回の一覧で返す数と、1回の削除で受け付ける数の上限 */
export const R2_PAGE_SIZE = 1000;

/** R2 のバインディングのうち、ここで使う部分（@cloudflare/workers-types に頼らない） */
export type R2BucketLike = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  list(options?: { limit?: number; cursor?: string }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
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
    async list({ limit, cursor }) {
      const page = await bucket.list({ limit: Math.min(limit, R2_PAGE_SIZE), ...(cursor && { cursor }) });
      return {
        objects: page.objects.map((o) => ({ name: o.key, uploaded: new Date(o.uploaded) })),
        cursor: page.truncated && page.cursor ? page.cursor : null,
      };
    },
    async delete(names) {
      for (let i = 0; i < names.length; i += R2_PAGE_SIZE) await bucket.delete(names.slice(i, i + R2_PAGE_SIZE));
    },
  };
}

type MemoryImage = { body: Uint8Array; contentType: string; uploaded: Date };

export function memoryImageStore(): ImageStore & { files: Map<string, MemoryImage> } {
  const files = new Map<string, MemoryImage>();
  return {
    files,
    async put(name, body, contentType) {
      files.set(name, { body, contentType, uploaded: new Date() });
    },
    async get(name) {
      return files.get(name) ?? null;
    },
    // 続きの印は、前の回の最後の名前
    async list({ limit, cursor }) {
      const names = [...files.keys()].sort().filter((n) => cursor === undefined || n > cursor);
      const page = names.slice(0, limit);
      return {
        objects: page.map((name) => ({ name, uploaded: files.get(name)!.uploaded })),
        cursor: names.length > page.length ? page[page.length - 1]! : null,
      };
    },
    async delete(names) {
      for (const name of names) files.delete(name);
    },
  };
}
