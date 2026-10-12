import type { QueryClient } from "@tanstack/react-query";

/** 版が増えたあと、版やタイトルを出している所を読み直す */
export function invalidateAfterNewVersion(qc: QueryClient, pageId: string) {
  void qc.invalidateQueries({ queryKey: ["versions", pageId] });
  void qc.invalidateQueries({ queryKey: ["pages"] });
  void qc.invalidateQueries({ queryKey: ["search"] });
  void qc.invalidateQueries({ queryKey: ["structure"] });
  // 「予約後に編集あり」の表示を更新する
  void qc.invalidateQueries({ queryKey: ["schedule"] });
}
