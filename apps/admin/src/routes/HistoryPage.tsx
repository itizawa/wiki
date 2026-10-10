import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { StructureChange } from "@wiki/shared";
import { useState } from "react";
import { LoadingRegion, Mono, Muted, Row, Section, SkeletonRows, StatusChip, WithSidebar } from "../components/ui";
import { api, errorMessage, type StructureResponse } from "../lib/api";
import { formatDateTime } from "../lib/format";

/** コミットの行の高さ（メッセージ + 日時の2段）。 */
const COMMIT_ROW_HEIGHT = 72;

export function HistoryPage() {
  const history = useQuery({ queryKey: ["history"], queryFn: api.history });
  const structure = useQuery({ queryKey: ["structure"], queryFn: api.structure });
  const [selected, setSelected] = useState<string | null>(null);

  if (history.error) return <Alert severity="error">{errorMessage(history.error)}</Alert>;

  return (
    <WithSidebar>
      <Section>
        <Typography variant="h6" component="h2">
          構造の履歴（main）
        </Typography>
        <Muted>ツリーへの変更はすべてコミットとして記録されます。巻き戻しはフェーズ3で追加します。</Muted>
        {/* コミットの行（メッセージ + 日時）と同じ高さ */}
        {history.isPending && <SkeletonRows rows={5} height={COMMIT_ROW_HEIGHT} secondary sx={{ mt: 1, mx: -1 }} />}
        <List disablePadding sx={{ mt: history.isPending ? 0 : 1, mx: -1 }}>
          {history.data?.commits.map((c, i) => (
            <ListItemButton key={c.id} selected={selected === c.id} onClick={() => setSelected(c.id)} sx={{ px: 1, borderRadius: 1 }}>
              <ListItemText
                primary={
                  <Row>
                    <span>{c.message ?? "(no message)"}</span>
                    {i === 0 && <StatusChip label="head" />}
                    {c.authorType === "ai" && <StatusChip label="AI" />}
                    {c.via && <StatusChip label={`${c.via} 経由`} />}
                    {c.parentIds.length > 1 && <StatusChip label="merge" />}
                  </Row>
                }
                secondary={
                  <>
                    {formatDateTime(c.createdAt)} · <Mono>{c.id.slice(0, 8)}</Mono>
                  </>
                }
              />
            </ListItemButton>
          ))}
        </List>
      </Section>
      <Section>{selected ? <CommitDetail id={selected} structure={structure.data} /> : <Muted>コミットを選ぶと差分を表示します。</Muted>}</Section>
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
      <Typography variant="subtitle1" component="h3">
        {detail.data.commit.message}
      </Typography>
      {byTree.size === 0 && <Muted>構造の変更はありません。</Muted>}
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
