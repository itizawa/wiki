import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
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
import { Muted, tagChipSx } from "./ui";

const MenuItemLink = createLink(MenuItem);

/**
 * タグの付け外し。押すとすぐ反映し（応答を待たずに見た目を変える）、失敗したら元に戻して理由を返す。
 * 編集画面が開いているページと同じキャッシュを使うので、メニューとタイトル下のどちらで付け外ししても、表示が揃う。
 */
export function usePageTagToggle(pageId: string, current: readonly PageTag[] | undefined) {
  const qc = useQueryClient();
  // 直近の付け外しの失敗。次に押すまで、メニューの先頭に出しておく
  const [failure, setFailure] = useState<string | null>(null);
  const attached = new Set(current?.map((t) => t.id));

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
  return { failure, toggle, attached };
}

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
  const { role } = useWiki();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags, enabled: open });
  // 編集画面が開いているページと同じキャッシュを使うので、どちらで付け外ししても、もう一方の表示が揃う
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId), enabled: open });
  const { failure, toggle, attached } = usePageTagToggle(pageId, page.data?.tags);

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

/**
 * 編集画面のタイトルの下に置く、タグの付け外し。ウィキにあるタグを並べ、付いているものは塗って「レ」を付ける。押すと付け外しする。
 * タグの左右の余白は `tagChipSx`（一覧のタグ列・絞り込みと共通）。タグ同士の間は外側の `ul` の gap。
 */
export function PageTagToggles({ pageId, tags }: { pageId: string; tags: readonly PageTag[] }) {
  const { role } = useWiki();
  const all = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const { failure, toggle, attached } = usePageTagToggle(pageId, tags);
  if (all.error) {
    return (
      <Muted role="alert" sx={{ mb: 1.5, color: "error.main", fontSize: "0.8125rem" }}>
        タグを読み込めませんでした：{errorMessage(all.error)}
      </Muted>
    );
  }
  const list = all.data?.tags ?? [];
  if (list.length === 0) {
    // 作れるのは管理者だけ。作る場所へ案内する
    return role === "admin" && all.data ? (
      <Box sx={{ mb: 1.5 }}>
        <Link {...screenLink("/w/$wikiKey/settings/tags")} variant="body2">
          タグを作る（設定のタグ管理）
        </Link>
      </Box>
    ) : null;
  }
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box component="ul" aria-label="タグ" sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, listStyle: "none", m: 0, p: 0 }}>
        {list.map((tag) => {
          const on = attached.has(tag.id);
          return (
            <li key={tag.id}>
              <Chip
                size="small"
                clickable
                component="button"
                type="button"
                role="switch"
                aria-checked={on}
                variant={on ? "filled" : "outlined"}
                color={on ? "primary" : "default"}
                icon={on ? <Check size={14} /> : <Tag size={14} />}
                label={tag.name}
                onClick={() => toggle.mutate({ tag, on: !on })}
                sx={{ maxWidth: "100%", ...tagChipSx }}
              />
            </li>
          );
        })}
      </Box>
      {failure && (
        <Muted role="alert" sx={{ mt: 0.75, color: "error.main", fontSize: "0.8125rem" }}>
          {failure}
        </Muted>
      )}
    </Box>
  );
}
