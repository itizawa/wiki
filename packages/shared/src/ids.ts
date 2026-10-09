import { customAlphabet } from "nanoid";

const alnum = "0123456789abcdefghijklmnopqrstuvwxyz";

/** ページID。短く安定した英数字（URL `/p/{id}-{slug}` に使う）。 */
export const newPageId = customAlphabet(alnum, 10);

/** folderノードのID。ページID（英数字のみ）と衝突しないよう `f_` を前置する。 */
const folderSuffix = customAlphabet(alnum, 10);
export const newFolderNodeId = () => `f_${folderSuffix()}`;

/** ツリーID。 */
const treeSuffix = customAlphabet(alnum, 10);
export const newTreeId = () => `t_${treeSuffix()}`;

/** 限定公開URL用キー。128bit以上の推測不能な値（base64url、22文字=132bit）。 */
export function newUnlistedKey(): string {
  const bytes = new Uint8Array(17);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

/** Inbox（未整理ページの置き場）の固定ノードID。各ツリーの最上位に1つだけ置ける。 */
export const INBOX_NODE_ID = "_inbox";
