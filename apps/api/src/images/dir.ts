import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageStore } from "./store";

/** 手元の開発用。形式は名前の拡張子から分かるので、中身だけを置く */
export function dirImageStore(dir: string, typeOf: (name: string) => string | null): ImageStore {
  return {
    async put(name, body) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), body);
    },
    async get(name) {
      const contentType = typeOf(name);
      if (!contentType) return null;
      try {
        return { body: new Uint8Array(await readFile(join(dir, name))), contentType };
      } catch {
        return null;
      }
    },
  };
}
