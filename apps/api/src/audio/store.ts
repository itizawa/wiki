import { dirImageStore } from "../images/dir";
import { memoryImageStore, r2ImageStore, type ImageStore } from "../images/store";

/**
 * ページに添付した音声の置き場所。画像と同じ形（名前で出し入れし、一覧を読み、まとめて消す）だが、**別のバケット**に置く
 * （本番は R2 の `wiki-audio`、手元の開発はディレクトリ、テストはメモリ）。公開の配信経路は無い。
 * 名前は `{行の ID}.{拡張子}`（`audioObjectName`）。
 */
export type AudioStore = ImageStore;

export const r2AudioStore = r2ImageStore;
export const memoryAudioStore = memoryImageStore;
export const dirAudioStore = dirImageStore;
