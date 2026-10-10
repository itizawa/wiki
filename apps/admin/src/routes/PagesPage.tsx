import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Mono, Muted, RouterLink, Row, Section, StatusChip } from "../components/ui";
import { workflowLabel } from "../components/WorkflowPanel";
import { api, errorMessage } from "../lib/api";
import { pageLink } from "../lib/wiki";
import { formatDateTime } from "../lib/format";

export function PagesPage() {
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const pages = useQuery({ queryKey: ["pages", q], queryFn: () => api.listPages(q) });
  const create = useMutation({
    mutationFn: () => api.createPage({ title }),
    onSuccess: (page) => navigate(pageLink(page.id)),
  });

  return (
    <Stack spacing={1.5}>
      <Section>
        <Typography variant="h6" component="h2" gutterBottom>
          新しいページ
        </Typography>
        <Row
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <TextField value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル" sx={{ flex: 1, minWidth: 0 }} />
          <Button type="submit" variant="contained" size="medium" disabled={!title.trim() || create.isPending}>
            作成
          </Button>
        </Row>
        {create.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage(create.error)}
          </Alert>
        )}
      </Section>

      <Section>
        <Row sx={{ mb: 1 }}>
          <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0 }}>
            ページ
          </Typography>
          <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="タイトルで絞り込み" />
        </Row>
        {pages.isPending && <Muted>読み込み中…</Muted>}
        {pages.error && <Alert severity="error">{errorMessage(pages.error)}</Alert>}
        {pages.data && pages.data.pages.length === 0 && <Muted>ページはまだありません。</Muted>}
        <Table size="small">
          <TableBody>
            {pages.data?.pages.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <RouterLink {...pageLink(p.id)}>
                    {p.title}
                  </RouterLink>
                </TableCell>
                <TableCell>
                  <Muted component="span">
                    <Mono>{p.id}</Mono>
                  </Muted>
                </TableCell>
                <TableCell>
                  <Row>
                    <StatusChip status={p.visibility} label={visibilityLabel[p.visibility]} />
                    {p.workflowState !== "draft" && <StatusChip label={workflowLabel[p.workflowState]} />}
                    {p.origin === "ai_draft" && <StatusChip label="AI下書き" />}
                    {p.reviewRequestedAt && <StatusChip status="unlisted" label="見直し待ち" />}
                  </Row>
                </TableCell>
                <TableCell>
                  <Muted component="span">{formatDateTime(p.updatedAt)}</Muted>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Stack>
  );
}

export const visibilityLabel = { public: "公開", unlisted: "限定公開", private: "非公開" } as const;
