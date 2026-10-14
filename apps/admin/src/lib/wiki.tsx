import type { WikiRole, WikiSummary } from "@wiki/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { currentWikiKey } from "./api";

/** `/w/{key}/...` の画面が共有するもの。 */
export type WikiContextValue = {
  /** いま開いている wiki */
  wiki: WikiSummary;
  /** 切り替え先として選べる wiki（使用中のもの） */
  wikis: WikiSummary[];
  /** wiki を作成・アーカイブできる人か */
  isOwner: boolean;
  /** この wiki でのロール（オーナーは管理者）。できない操作は出さない */
  role: WikiRole;
  /**
   * wiki の一覧（表示名・画像・ロール）を読み直す。一覧は wiki ごとの入れ物の外（WikiLayout の外側の QueryClient）にあるので、
   * wiki の画面の中から `invalidateQueries(["wikis"])` しても届かない。こちらを使う
   */
  refreshWikis: () => Promise<void>;
};

export const WikiContext = createContext<WikiContextValue | null>(null);

/**
 * wiki の一覧を読み直す関数。wiki の画面の中では外側の入れ物の一覧を、外（全体の管理など）ではいまの入れ物の一覧を読み直す。
 * 表示名や画像を変えたあと、サイドバーの切り替えメニューにすぐ映すのに使う。
 */
export function useRefreshWikis(): () => Promise<void> {
  const ctx = useContext(WikiContext);
  const qc = useQueryClient();
  return ctx ? ctx.refreshWikis : () => qc.invalidateQueries({ queryKey: ["wikis"] });
}

export function useWiki(): WikiContextValue {
  const value = useContext(WikiContext);
  if (!value) throw new Error("useWiki must be used inside a wiki screen");
  return value;
}

/** 最初の wiki の key。wiki が1つだった頃の内容（ページ・その頃の URL・ブラウザに覚えさせたスター）は、ここにある。 */
export const FIRST_WIKI = "wiki";

const LAST_WIKI = "wiki.last";

/** 最後に開いていた wiki の key（`/` を開いたときの行き先）。 */
export function lastWikiKey(): string | null {
  try {
    return localStorage.getItem(LAST_WIKI);
  } catch {
    return null;
  }
}

export function rememberWiki(key: string) {
  try {
    localStorage.setItem(LAST_WIKI, key);
  } catch {
    // 覚えられなくても、最初の wiki を開くだけなので続ける
  }
}

/** `/` を開いたときに入る wiki：最後に開いていたもの、無ければ一覧の先頭。使用中の wiki が無ければ null。 */
export function pickWiki<T extends { key: string; archivedAt: string | null }>(wikis: readonly T[], last: string | null): T | null {
  const active = wikis.filter((w) => w.archivedAt === null);
  return active.find((w) => w.key === last) ?? active[0] ?? null;
}

/** 開いている wiki のページへのリンク。`<RouterLink {...pageLink(id)}>` のように使う。 */
export function pageLink(pageId: string) {
  return { to: "/w/$wikiKey/pages/$pageId", params: { wikiKey: currentWikiKey(), pageId } } as const;
}

/** 開いている wiki のテンプレートの編集画面へのリンク。 */
export function templateLink(templateId: string) {
  return { to: "/w/$wikiKey/templates/$templateId", params: { wikiKey: currentWikiKey(), templateId } } as const;
}

/** 開いている wiki の画面（一覧・検索・カレンダー・アクセス解析・テンプレート・ゴミ箱・設定とそのタブ）へのリンク。 */
export type WikiScreen =
  | "/w/$wikiKey"
  | "/w/$wikiKey/pages"
  | "/w/$wikiKey/requests"
  | "/w/$wikiKey/search"
  | "/w/$wikiKey/calendar"
  | "/w/$wikiKey/analytics"
  | "/w/$wikiKey/templates"
  | "/w/$wikiKey/trash"
  | "/w/$wikiKey/settings"
  | "/w/$wikiKey/settings/appearance"
  | "/w/$wikiKey/settings/home"
  | "/w/$wikiKey/settings/integrations"
  | "/w/$wikiKey/settings/sns"
  | "/w/$wikiKey/settings/tags"
  | "/w/$wikiKey/settings/members"
  | "/w/$wikiKey/settings/audit";
export function screenLink<T extends WikiScreen>(to: T) {
  return { to, params: { wikiKey: currentWikiKey() } } as const;
}
