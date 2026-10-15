import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageStore, StoredImage } from "./store";

/** 手元の開発用。形式は名前の拡張子から分かるので、中身だけを置く */
export function dirImageStore(dir: string, typeOf: (name: string) => string | null): ImageStore {
  return {
    async put(name, body) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), body);
    },
    async get(name, range) {
      const contentType = typeOf(name);
      if (!contentType) return null;
      try {
        const all = new Uint8Array(await readFile(join(dir, name)));
        return { body: range ? all.slice(range.offset, range.offset + range.length) : all, contentType };
      } catch {
        return null;
      }
    },
    // 続きの印は、前の回の最後の名前。置いた時刻はファイルの更新時刻
    async list({ limit, cursor }) {
      const all = await readdir(dir).catch(() => [] as string[]);
      const names = all.sort().filter((n) => cursor === undefined || n > cursor);
      const page = names.slice(0, limit);
      const objects: StoredImage[] = [];
      for (const name of page) {
        const info = await stat(join(dir, name)).catch(() => null);
        if (info?.isFile()) objects.push({ name, uploaded: info.mtime });
      }
      return { objects, cursor: names.length > page.length ? page[page.length - 1]! : null };
    },
    async delete(names) {
      for (const name of names) await rm(join(dir, name), { force: true });
    },
  };
}
