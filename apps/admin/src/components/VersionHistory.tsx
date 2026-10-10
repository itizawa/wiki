import { X } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { diffLines } from "diff";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { monoFont } from "../theme";
import { Tooltip } from "./Tooltip";
import { LoadingRegion, Muted, SkeletonRows, StatusChip } from "./ui";

type Content = { title: string; bodyMd: string };

/** 版の一覧の行の高さ。 */
const VERSION_ROW_HEIGHT = 32;

const asDocument = (c: Content) => `# ${c.title}\n\n${c.bodyMd}`;

/**
 * 版履歴。画面全体に重ねて開き、左に選んだ版（編集中の内容との差分か、その版の本文）、右に版の一覧を出す。
 * 開いている版は URL（`?history={版のID}`）に持つので、再読み込みしても同じ版が開く。
 */
export function VersionHistory(props: {
  pageId: string;
  headVersionId: string;
  /** 開いている版。null なら閉じている */
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  current: Content;
  onRestore: (v: Content) => void;
}) {
  const open = props.selected !== null;
  const versions = useQuery({
    queryKey: ["versions", props.pageId, props.headVersionId],
    queryFn: () => api.listVersions(props.pageId),
    enabled: open,
  });
  const version = useQuery({
    queryKey: ["version", props.pageId, props.selected],
    queryFn: () => api.getVersion(props.pageId, props.selected!),
    enabled: open,
  });
  const [view, setView] = useState<"diff" | "body">("diff");

  // 選んでいた版が、もう無い（開いているあいだに間引かれた、古い URL を開いた）。最新の版に選び直し、一覧を読み直す
  const qc = useQueryClient();
  const [missing, setMissing] = useState(false);
  const selectedIsGone = version.error instanceof ApiError && version.error.status === 404 && props.selected !== props.headVersionId;
  const { pageId, headVersionId, onSelect } = props;
  useEffect(() => {
    if (!selectedIsGone) return;
    setMissing(true);
    void qc.invalidateQueries({ queryKey: ["versions", pageId] });
    onSelect(headVersionId);
    // onSelect は描くたびに作り直されるので、依存に入れない
  },[selectedIsGone, pageId, headVersionId, qc]);
  useEffect(() => {
    if (!open) setMissing(false);
  }, [open]);

  return (
    <Dialog fullScreen open={open} onClose={props.onClose} aria-labelledby="version-history-title">
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, height: 48, px: 2, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Typography id="version-history-title" variant="subtitle1" component="h2" sx={{ flex: 1 }}>
          版履歴
        </Typography>
        <Tooltip title="閉じる (Esc)">
          <IconButton size="small" aria-label="版履歴を閉じる" onClick={props.onClose}>
            <X size={18} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          // 狭い画面では一覧を上、選んだ版を下に重ねる
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 300px" },
          gridTemplateRows: { xs: "minmax(0, 200px) minmax(0, 1fr)", md: "minmax(0, 1fr)" },
        }}
      >
        <Box component="section" aria-label="選んだ版" sx={{ order: { xs: 2, md: 1 }, overflow: "auto", p: { xs: 2, md: 3 } }}>
          {missing && (
            <Alert severity="info" onClose={() => setMissing(false)} sx={{ maxWidth: 900, mx: "auto", mb: 2 }}>
              選んでいた版は、もうありません（「自動」の版は、古くなると間引きます）。最新の版を開いています。
            </Alert>
          )}
          {version.error && !selectedIsGone && <Alert severity="error">{errorMessage(version.error)}</Alert>}
          {version.isPending && (
            // 見出し（版の日時）と、差分の位置に文の行
            <LoadingRegion sx={{ maxWidth: 900, mx: "auto" }}>
              <Skeleton variant="text" width="40%" sx={{ fontSize: "1.1rem", mb: 2 }} />
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" />
              <Skeleton variant="text" width="60%" />
            </LoadingRegion>
          )}
          {version.data && (
            <Stack spacing={2} sx={{ maxWidth: 900, mx: "auto" }}>
              <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <Typography variant="h6" component="h3" sx={{ mr: "auto" }}>
                  {formatDateTime(version.data.createdAt)} の版
                  {version.data.id === props.headVersionId && <StatusChip label="最新の版" size="small" sx={{ ml: 1 }} />}
                  {!version.data.keep && <StatusChip label="自動" size="small" sx={{ ml: 1 }} />}
                  {version.data.authorType === "ai" && <StatusChip label="AI" size="small" sx={{ ml: 1 }} />}
                </Typography>
                <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label="表示">
                  <ToggleButton value="diff">編集中の内容との差分</ToggleButton>
                  <ToggleButton value="body">この版の本文</ToggleButton>
                </ToggleButtonGroup>
                <Button variant="contained" onClick={() => props.onRestore(version.data!)}>
                  この版に戻す
                </Button>
              </Stack>
              <Muted>
                「この版に戻す」は、この版の内容をエディタに入れて閉じます。戻した内容は、ほかの編集と同じく自動で保存され、新しい版になります。公開中の内容は、公開し直すまで変わりません。
              </Muted>
              {view === "diff" ? (
                <Diff before={asDocument(version.data)} after={asDocument(props.current)} />
              ) : (
                <Box component="pre" sx={{ fontFamily: monoFont, fontSize: "0.85rem", m: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {asDocument(version.data)}
                </Box>
              )}
            </Stack>
          )}
        </Box>
        <Box
          component="nav"
          aria-label="版の一覧"
          sx={(t) => ({
            order: { xs: 1, md: 2 },
            overflow: "auto",
            p: 1,
            [t.breakpoints.up("md")]: { borderLeft: `1px solid ${t.palette.divider}` },
            [t.breakpoints.down("md")]: { borderBottom: `1px solid ${t.palette.divider}` },
          })}
        >
          {versions.isPending && <SkeletonRows rows={3} height={VERSION_ROW_HEIGHT} />}
          <List dense disablePadding>
            {versions.data?.versions.map((v) => (
              <ListItemButton
                key={v.id}
                selected={props.selected === v.id}
                aria-current={props.selected === v.id ? "true" : undefined}
                onClick={() => {
                  setMissing(false);
                  props.onSelect(v.id);
                }}
                sx={{ px: 1, gap: 0.75, borderRadius: 1 }}
              >
                {formatDateTime(v.createdAt)}
                {v.id === props.headVersionId && <StatusChip label="最新" size="small" />}
                {/* 下書きから自動でできた版。人が「版として残す」を選ぶか、公開・予約に使うと外れる */}
                {!v.keep && <StatusChip label="自動" size="small" />}
                {v.authorType === "ai" && <StatusChip label="AI" size="small" />}
                {v.via && <StatusChip label={`${v.via} 経由`} size="small" />}
              </ListItemButton>
            ))}
          </List>
          {versions.data && (
            <Muted variant="caption" component="p" sx={{ px: 1, pt: 1.5, pb: 1 }}>
              「自動」の版は、1日たつと1日に1つ、30日たつと1か月に1つに間引きます。⌘S で残した版と、公開・予約した版は消しません。
            </Muted>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  if (parts.every((p) => !p.added && !p.removed)) return <Muted>編集中の内容と同じです。</Muted>;
  return (
    <Box component="pre" sx={{ fontFamily: monoFont, fontSize: "0.85rem", m: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {parts.map((p, i) => (
        <Box
          key={i}
          component="span"
          sx={{ display: "block", bgcolor: p.added ? "diff.added" : p.removed ? "diff.removed" : undefined, color: p.added || p.removed ? undefined : "text.secondary" }}
        >
          {p.value
            .replace(/\n$/, "")
            .split("\n")
            .map((line) => `${p.added ? "+" : p.removed ? "-" : " "} ${line}`)
            .join("\n")}
        </Box>
      ))}
    </Box>
  );
}
