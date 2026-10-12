import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useQuery } from "@tanstack/react-query";
import { STRUCTURE_SNAPSHOT_KEEP_DAYS, type StructureChange } from "@wiki/shared";
import { X } from "lucide-react";
import { useState } from "react";
import { HelpHeading } from "../components/HelpTip";
import { Tooltip } from "../components/Tooltip";
import { LoadingRegion, Mono, Muted, Row, Section, SkeletonRows, StatusChip, WithSidebar } from "../components/ui";
import { api, errorMessage, type StructureResponse } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { commitMessageLabel } from "../lib/historyLabels";

/** コミットの行の高さ（メッセージ + 日時の2段）。 */
const COMMIT_ROW_HEIGHT = 72;

export function HistoryPage() {
  const history = useQuery({ queryKey: ["history"], queryFn: api.history });
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const [selected, setSelected] = useState<string | null>(null);
  // 一覧と差分が縦に並ぶ幅（WithSidebar の md 未満）では、差分が一覧の下で見えないので全画面で出す
  const stacked = useMediaQuery(useTheme().breakpoints.down("md"));

  if (history.error) return <Alert severity="error">{errorMessage(history.error)}</Alert>;

  return (
    <WithSidebar>
      <Section>
        <HelpHeading variant="h6" component="h2" about="「構造の履歴」" help="ツリーへの変更はすべてコミットとして記録されます。">
          構造の履歴
        </HelpHeading>
        {/* 選ぶ前に分かるよう、差分を見られる範囲を先に書く */}
        <Muted>差分を見られるのは、最新のコミットと、直近{STRUCTURE_SNAPSHOT_KEEP_DAYS}日のコミットです。</Muted>
        {/* コミットの行（メッセージ + 日時）と同じ高さ */}
        {history.isPending && <SkeletonRows rows={5} height={COMMIT_ROW_HEIGHT} secondary sx={{ mt: 1, mx: -1 }} />}
        <List disablePadding sx={{ mt: history.isPending ? 0 : 1, mx: -1 }}>
          {history.data?.commits.map((c, i) => (
            <ListItemButton key={c.id} selected={selected === c.id} onClick={() => setSelected(c.id)} sx={{ px: 1, borderRadius: 1 }}>
              <ListItemText
                primary={
                  <Row>
                    <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{commitMessageLabel(c.message)}</span>
                    {i === 0 && <StatusChip label="最新" />}
                    {c.authorType === "ai" && <StatusChip label="AI" />}
                    {c.via && <StatusChip label={`${c.via} 経由`} />}
                    {c.parentIds.length > 1 && <StatusChip label="統合" />}
                    {!c.diffAvailable && <StatusChip label="差分は見られません" />}
                  </Row>
                }
                secondary={
                  <>
                    {formatDateTime(c.createdAt)}
                    {c.createdBy && ` · ${c.createdBy.name}`} · <Mono>{c.id.slice(0, 8)}</Mono>
                  </>
                }
              />
            </ListItemButton>
          ))}
        </List>
      </Section>
      {stacked ? (
        // 閉じると、MUI が押した行（ListItemButton）へフォーカスを戻す
        <Dialog fullScreen open={selected !== null} onClose={() => setSelected(null)} aria-labelledby="commit-diff-title">
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, height: 48, px: 2, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
            <Typography id="commit-diff-title" variant="subtitle1" component="h2" sx={{ flex: 1 }}>
              コミットの差分
            </Typography>
            <Tooltip title="閉じる (Esc)">
              <IconButton size="small" aria-label="差分を閉じて、一覧に戻る" onClick={() => setSelected(null)}>
                <X size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>{selected && <CommitDetail id={selected} structure={structure.data} />}</Box>
        </Dialog>
      ) : (
        <Section>{selected ? <CommitDetail id={selected} structure={structure.data} /> : <Muted>コミットを選ぶと差分を表示します。</Muted>}</Section>
      )}
    </WithSidebar>
  );
}

function CommitDetail({ id, structure }: { id: string; structure?: StructureResponse }) {
  const detail = useQuery({ queryKey: ["commit", id], queryFn: () => api.commitDetail(id) });
  if (detail.isPending) {
    // 見出し（コミットのメッセージ）と、変更の行
    return (
      <LoadingRegion>
        <Skeleton variant="text" width="50%" sx={{ fontSize: "1rem", mb: 1.5 }} />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <Skeleton variant="text" width="60%" />
      </LoadingRegion>
    );
  }
  if (detail.error) return <Alert severity="error">{errorMessage(detail.error)}</Alert>;

  const treeName = (treeId: string) => structure?.trees.find((t) => t.id === treeId)?.name ?? treeId;
  const nodeName = (nodeId: string | null) => {
    if (nodeId === null) return "最上位";
    return structure?.pages[nodeId]?.title ?? nodeId;
  };
  const describe = (c: StructureChange): string => {
    switch (c.kind) {
      case "tree_added":
        return "ツリーを追加";
      case "tree_removed":
        return "ツリーを削除";
      case "node_added":
        return `追加: ${nodeName(c.node.nodeId)} → ${nodeName(c.node.parentNodeId)}`;
      case "node_removed":
        return `削除: ${nodeName(c.node.nodeId)}`;
      case "node_moved":
        return `移動: ${nodeName(c.nodeId)}（${nodeName(c.from)} → ${nodeName(c.to)}）`;
      case "node_reordered":
        return `並び替え: ${nodeName(c.nodeId)}`;
    }
  };

  const byTree = new Map<string, StructureChange[]>();
  for (const c of detail.data.changes) byTree.set(c.treeId, [...(byTree.get(c.treeId) ?? []), c]);

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" component="h3" sx={{ overflowWrap: "anywhere" }}>
        {commitMessageLabel(detail.data.commit.message)}
      </Typography>
      {!detail.data.diffAvailable && (
        <Alert severity="info">
          このコミットの差分は表示できません。{STRUCTURE_SNAPSHOT_KEEP_DAYS}
          日より前のコミットは、その時点のツリーの記録を削除しています。誰が・いつ・何をしたかの記録は残ります。
        </Alert>
      )}
      {detail.data.diffAvailable && byTree.size === 0 && <Muted>構造の変更はありません。</Muted>}
      {[...byTree].map(([treeId, changes]) => (
        <div key={treeId}>
          <Typography variant="subtitle2" component="h4">
            {treeName(treeId)}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
            {changes.map((c, i) => (
              <Box
                component="li"
                key={i}
                sx={{
                  color:
                    c.kind === "node_added" || c.kind === "tree_added"
                      ? "success.main"
                      : c.kind === "node_removed" || c.kind === "tree_removed"
                        ? "error.main"
                        : undefined,
                }}
              >
                {describe(c)}
              </Box>
            ))}
          </Box>
        </div>
      ))}
    </Stack>
  );
}
