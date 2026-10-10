import PostAddIcon from "@mui/icons-material/PostAdd";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Muted, RouterLink, Row } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { screenLink } from "../lib/wiki";

/**
 * 空のページを、テンプレートから始めるための選択肢。変数を置き換えた内容をエディタに入れる（保存は人がする）。
 * テンプレートが1つも無ければ何も出さない。
 */
export function TemplatePicker({ onApply }: { onApply: (t: { title: string; bodyMd: string }) => void }) {
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const apply = useMutation({ mutationFn: (id: string) => api.renderTemplate(id), onSuccess: onApply });
  const list = templates.data?.templates ?? [];
  if (list.length === 0) return null;

  return (
    <Box component="section" aria-label="テンプレートから始める" sx={{ mb: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Muted sx={{ mb: 1 }}>
        テンプレートから始める（
        <RouterLink {...screenLink("/w/$wikiKey/templates")} color="inherit">
          テンプレートの管理
        </RouterLink>
        ）
      </Muted>
      <Row>
        {list.map((t) => (
          <Button key={t.id} variant="outlined" size="small" startIcon={<PostAddIcon fontSize="small" />} disabled={apply.isPending} onClick={() => apply.mutate(t.id)}>
            {t.title}
          </Button>
        ))}
      </Row>
      {apply.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {errorMessage(apply.error)}
        </Alert>
      )}
    </Box>
  );
}
