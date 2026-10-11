import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "./api";
import { pageLink } from "./wiki";

/**
 * テンプレートからページを作り、そのページを開く。
 * コマンドメニュー（どの画面にも出る）も使うので、テンプレートの画面（エディタを import する）とは分けて置く。
 */
export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: { templateId: string; title?: string; parentPageId?: string | null }) => api.createPage(input),
    onSuccess: async (page) => {
      void qc.invalidateQueries({ queryKey: ["structure"] });
      void qc.invalidateQueries({ queryKey: ["pages"] });
      await navigate(pageLink(page.id));
    },
  });
}
