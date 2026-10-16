import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLink } from "@tanstack/react-router";
import type { PageDetail, PageTag, WikiTag } from "@wiki/shared";
import { Check, Settings, Tag } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { invalidateAfterTagChange } from "../lib/invalidatePageLists";
import { withTag } from "../lib/pageTags";
import { screenLink, useWiki } from "../lib/wiki";
import { Muted } from "./ui";

const MenuItemLink = createLink(MenuItem);

/**
 * ページにタグを付け外しするメニュー。ページメニュー（編集画面）と、サイドバーの行メニューの両方から開く。
 * タグごとに、付いていればチェックが入る。押すとすぐ反映し（付け外しの応答を待たずに見た目を変える）、失敗したら元に戻して、メニューの中に理由を出す（メニューが Snackbar を覆うため）。
 * 付け外しのあとも閉じない（続けて何件も付け外しできる）。Esc か外を押すと閉じる。
 */
export function PageTagMenu(props: {
  pageId: string;
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}) {
  const { pageId, open } = props;
  const qc = useQueryClient();
  const { role } = useWiki();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags, enabled: open });
  // 編集画面が開いているページと同じキャッシュを使うので、どちらで付け外ししても、もう一方の表示が揃う
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId), enabled: open });
  // 直近の付け外しの失敗。次に押すまで、メニューの先頭に出しておく
  const [failure, setFailure] = useState<string | null>(null);
  const attached = new Set(page.data?.tags.map((t) => t.id));

  const toggle = useMutation({
    mutationFn: ({ tag, on }: { tag: WikiTag; on: boolean }) => (on ? api.attachTag(pageId, tag.id) : api.detachTag(pageId, tag.id)),
    onMutate: async ({ tag, on }) => {
      setFailure(null);
      await qc.cancelQueries({ queryKey: ["page", pageId] });
      qc.setQueryData<PageDetail>(["page", pageId], (cur) => cur && { ...cur, tags: withTag(cur.tags, tag, on) });
    },
    // 失敗したぶんだけ戻す（続けて押した、ほかのタグの先取りは残す）
    onError: (err, { tag, on }) => {
      qc.setQueryData<PageDetail>(["page", pageId], (cur) => cur && { ...cur, tags: withTag(cur.tags, tag, !on) });
      setFailure(`タグ「${tag.name}」を${on ? "付け" : "外せ"}ませんでした：${errorMessage(err)}`);
    },
    onSettled: () => invalidateAfterTagChange(qc, pageId),
  });

  const error = tags.error ?? page.error;
  const ready = tags.data && page.data;

  return (
    <Menu open={open} anchorEl={props.anchorEl} onClose={props.onClose} slotProps={{ list: { dense: true, "aria-label": "タグ" }, paper: { sx: { minWidth: 200, maxWidth: "calc(100vw - 32px)" } } }}>
      {error ? (
        <Muted component="li" role="none" sx={{ px: 2, py: 1, maxWidth: 280 }}>
          タグを読み込めませんでした：{errorMessage(error)}
        </Muted>
      ) : !ready ? (
        <Muted component="li" role="none" sx={{ px: 2, py: 1 }}>
          読み込み中…
        </Muted>
      ) : tags.data.tags.length === 0 ? (
        [
          <Muted key="empty" component="li" role="none" sx={{ px: 2, py: 1, maxWidth: 280 }}>
            タグがありません
          </Muted>,
          role === "admin" ? (
            <MenuItemLink key="create" {...screenLink("/w/$wikiKey/settings/tags")} onClick={props.onClose}>
              <ListItemIcon>
                <Settings size={18} />
              </ListItemIcon>
              <ListItemText>設定の「タグ管理」でタグを作る</ListItemText>
            </MenuItemLink>
          ) : (
            <Muted key="ask" component="li" role="none" sx={{ px: 2, pb: 1, maxWidth: 280, fontSize: "0.8125rem" }}>
              管理者に作ってもらってください
            </Muted>
          ),
        ]
      ) : (
        [
          failure && (
            <Muted key="failure" component="li" role="alert" sx={{ px: 2, py: 1, maxWidth: 280, color: "error.main", fontSize: "0.8125rem" }}>
              {failure}
            </Muted>
          ),
          ...tags.data.tags.map((tag) => {
          const on = attached.has(tag.id);
          return (
            <MenuItem key={tag.id} role="menuitemcheckbox" aria-checked={on} onClick={() => toggle.mutate({ tag, on: !on })}>
              <ListItemIcon>{on && <Check size={18} />}</ListItemIcon>
              <ListItemText sx={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>{tag.name}</ListItemText>
            </MenuItem>
          );
          }),
        ]
      )}
    </Menu>
  );
}

/** 付いているタグの表示（編集画面のタイトルの下）。押せるようには見せない。 */
export function PageTagChips({ tags }: { tags: readonly PageTag[] }) {
  if (tags.length === 0) return null;
  return (
    <Box component="ul" aria-label="付いているタグ" sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, listStyle: "none", m: 0, mb: 1.5, p: 0 }}>
      {tags.map((t) => (
        <li key={t.id}>
          <Chip size="small" variant="outlined" icon={<Tag size={14} />} label={t.name} sx={{ maxWidth: "100%", cursor: "default" }} />
        </li>
      ))}
    </Box>
  );
}
