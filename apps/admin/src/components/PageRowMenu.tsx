import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton, { type IconButtonProps } from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Portal from "@mui/material/Portal";
import Snackbar from "@mui/material/Snackbar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { TreeNode } from "@wiki/shared";
import { Copy, Ellipsis, ExternalLink, Globe, Link, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage, type StructureResponse } from "../lib/api";
import { useDeletePage } from "../lib/deletePage";
import { focusAfterRemoval } from "../lib/focus";
import { formatDateTime } from "../lib/format";
import { publicPageUrl } from "../lib/publicUrl";
import { useStars } from "../lib/stars";
import { pageLink, useWiki } from "../lib/wiki";
import { Tooltip } from "./Tooltip";
import { Muted } from "./ui";

/** サイドバーが持っているページの情報（`GET /structure` の `pages`）。 */
export type RowMenuPage = StructureResponse["pages"][string];

/** どの行の「…」から開いたか。`key` は行ごとの名前（同じページが「スター」欄とツリーの両方に出るので、ページの id では決まらない）。 */
export type RowMenuTarget = { key: string; page: RowMenuPage; anchor: HTMLElement };

/** 版のタイトルの上限（API と同じ）。 */
const TITLE_MAX = 200;
const COPY_SUFFIX = " のコピー";

/** 複製したページのタイトル。上限を超えるときは、元のタイトルの後ろを削る。 */
export function copyTitle(title: string): string {
  return title.slice(0, TITLE_MAX - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX;
}

/** ツリーでの親ページの id。最上位のページ・ツリーに無いページは null。 */
export function parentPageId(nodes: readonly TreeNode[], pageId: string): string | null {
  const parentNodeId = nodes.find((n) => n.pageId === pageId)?.parentNodeId ?? null;
  return parentNodeId === null ? null : (nodes.find((n) => n.nodeId === parentNodeId)?.pageId ?? null);
}

/** 行の「…」ボタン。押すと、サイドバーに1つだけ置いた `PageRowMenu` がこのボタンの下に開く。 */
export function PageRowMenuButton(props: { title: string; open: boolean; onOpen: (anchor: HTMLElement) => void; sx?: IconButtonProps["sx"] }) {
  return (
    <Tooltip title="スター・複製などの操作">
      <IconButton
        size="small"
        aria-label={`「${props.title}」の操作`}
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={(e) => props.onOpen(e.currentTarget)}
        sx={props.sx}
      >
        <Ellipsis size={18} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * サイドバーの行の「…」メニュー。スターの付け外し・リンクのコピー・複製・新しいタブで開く・ゴミ箱に入れる。
 * 行ごとではなくサイドバーに1つだけ置く（スターを外す・ゴミ箱に入れると行が消えるが、結果の知らせは残したいため。
 * 行の中に置くと、メニューの中のクリックが行のドラッグやリンクにも届いてしまうためでもある）。
 */
export function PageRowMenu(props: {
  /** 開く相手。閉じている間も、最後に開いたものを渡したままにする（閉じる動きの間、中身を出しておく） */
  target: RowMenuTarget | null;
  open: boolean;
  onClose: () => void;
  /** いまのツリー。複製したページを、元のページと同じ親の下に置くのに使う */
  nodes: readonly TreeNode[];
  /** 別のページへ移ったあとに呼ぶ（狭い画面で、重ねて出したサイドバーを閉じる） */
  onNavigate?: () => void;
}) {
  const { target, onClose } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { origin } = useWiki().wiki;
  const { ids: starredIds, toggle: toggleStar } = useStars();
  const [notice, setNotice] = useState<string | null>(null);

  const { confirmAndDelete } = useDeletePage({
    onLeave: props.onNavigate,
    onError: (err) => setNotice(`ゴミ箱に入れられませんでした：${errorMessage(err)}`),
  });

  // 最新の版のタイトルと本文で、同じ親の末尾に新しいページを作る。公開の状態・予約・スター・版履歴・子ページ・版になっていない下書きは写さない
  const duplicate = useMutation({
    mutationFn: async (page: RowMenuPage) => {
      const { head } = await api.getPage(page.id);
      return api.createPage({ title: copyTitle(head.title), bodyMd: head.bodyMd, parentPageId: parentPageId(props.nodes, page.id) });
    },
    onSettled: () => {
      for (const key of ["structure", "history", "pages", "search"]) void qc.invalidateQueries({ queryKey: [key] });
    },
    onSuccess: async (created) => {
      setNotice(`「${created.title}」を作りました`);
      await navigate(pageLink(created.id));
      props.onNavigate?.();
    },
    onError: (err) => setNotice(`複製できませんでした：${errorMessage(err)}`),
  });

  const copyLink = async (url: string) => {
    onClose();
    try {
      await navigator.clipboard.writeText(url);
      setNotice("リンクをコピーしました");
    } catch {
      setNotice("コピーできませんでした。ブラウザでクリップボードの利用を許可してください");
    }
  };

  const page = target?.page;
  const starred = page ? starredIds.includes(page.id) : false;
  // 管理画面でのこのページの URL（いま開いている wiki の編集画面）
  const editorUrl = page ? window.location.origin + router.buildLocation(pageLink(page.id)).href : "";
  // 公開サイトの URL は、公開中・限定公開中のページにだけある
  const publicUrl = page && page.publishedVersionId !== null ? publicPageUrl(origin, page) : null;

  return (
    <>
      <Menu open={props.open && !!page} anchorEl={target?.anchor} onClose={onClose} slotProps={{ list: { dense: true, "aria-label": page ? `「${page.title}」の操作` : undefined } }}>
        {page && [
          <MenuItem
            key="star"
            onClick={() => {
              onClose();
              toggleStar(page.id);
            }}
          >
            <ListItemIcon>{starred ? <Box component={Star} size={18} fill="currentColor" sx={{ color: "warning.main" }} /> : <Star size={18} />}</ListItemIcon>
            <ListItemText>{starred ? "スターを外す" : "スターを付ける"}</ListItemText>
          </MenuItem>,
          <Divider key="d1" />,
          <MenuItem key="copy-editor" onClick={() => void copyLink(editorUrl)}>
            <ListItemIcon>
              <Link size={18} />
            </ListItemIcon>
            <ListItemText>編集画面のリンクをコピー</ListItemText>
          </MenuItem>,
          publicUrl && (
            <MenuItem key="copy-public" onClick={() => void copyLink(publicUrl)}>
              <ListItemIcon>
                <Globe size={18} />
              </ListItemIcon>
              <ListItemText>公開ページのリンクをコピー</ListItemText>
            </MenuItem>
          ),
          <MenuItem
            key="duplicate"
            disabled={duplicate.isPending}
            onClick={() => {
              onClose();
              duplicate.mutate(page);
            }}
          >
            <ListItemIcon>
              <Copy size={18} />
            </ListItemIcon>
            <ListItemText>複製</ListItemText>
          </MenuItem>,
          // 画面の移動なので、ボタンではなくリンクにする（⌘クリックや中クリックも効く）
          <MenuItem key="new-tab" component="a" href={editorUrl} target="_blank" rel="noopener" onClick={onClose}>
            <ListItemIcon>
              <ExternalLink size={18} />
            </ListItemIcon>
            <ListItemText>新しいタブで開く</ListItemText>
          </MenuItem>,
          <Divider key="d2" />,
          <MenuItem
            key="delete"
            onClick={() => {
              // 行ごと消えるので、次の行（無ければ前の行）のリンクにフォーカスを移す準備をしてから閉じる
              const row = target.anchor.closest("[role=treeitem]");
              const restore = focusAfterRemoval(row, { scope: row?.closest("[role=tree]"), focusSelector: "[role=treeitem] a[href]" });
              onClose();
              void confirmAndDelete(page, restore);
            }}
          >
            {/* ゴミ箱から元に戻せるので、赤にはしない（編集画面の「…」と同じ） */}
            <ListItemIcon>
              <Trash2 size={18} />
            </ListItemIcon>
            <ListItemText>ゴミ箱に入れる…</ListItemText>
          </MenuItem>,
          <Divider key="d3" />,
          // 押せない表示（メニューの項目にはしない）
          <Muted key="updated" component="li" role="none" sx={{ px: 2, pt: 0.25, pb: 0.5, fontSize: "0.75rem" }}>
            最終更新：{formatDateTime(page.updatedAt)}
          </Muted>,
        ]}
      </Menu>
      {/* 結果は、押したサイドバーの近く（左下）に出す。サイドバーの枠（狭い画面では重ねて出す枠）に切られないよう、body の直下に置く */}
      <Portal>
        <Snackbar
          open={notice !== null}
          message={notice}
          autoHideDuration={4000}
          onClose={() => setNotice(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        />
      </Portal>
    </>
  );
}
