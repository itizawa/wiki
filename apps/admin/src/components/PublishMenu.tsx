import { ChevronDown } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import Popover from "@mui/material/Popover";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { PageDetail } from "@wiki/shared";
import { useState } from "react";
import { PublishPanel } from "./PublishPanel";
import { WorkflowPanel } from "./WorkflowPanel";

const PANEL_ID = "publish-menu";

/** いまの公開範囲。ヘッダーのボタンに出す。 */
export function publishState(page: PageDetail): { label: string; color: "success" | "warning" | "inherit" } {
  if (page.publishedVersionId === null || page.visibility === "private") return { label: "非公開", color: "inherit" };
  return page.visibility === "unlisted" ? { label: "限定公開中", color: "warning" } : { label: "公開中", color: "success" };
}

/**
 * 編集画面の右上の「公開」。押すとボタンの下に小さな枠（狭い画面では下から出るシート）を開き、
 * 上に記事の状態（承認・見直し）、下に公開・予約を並べる。承認してから公開する順に上から進める。
 */
export function PublishMenu({ page, dirty }: { page: PageDetail; dirty: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("sm"));
  const state = publishState(page);
  const open = anchor !== null;
  const close = () => setAnchor(null);

  const content = (
    <Box id={PANEL_ID} sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <WorkflowPanel page={page} dirty={dirty} />
      <Divider />
      <PublishPanel page={page} dirty={dirty} />
    </Box>
  );

  return (
    <>
      <Button
        variant="outlined"
        color={state.color}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        endIcon={<ChevronDown size={18} />}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
      >
        {state.label}
      </Button>
      {narrow ? (
        <Drawer
          anchor="bottom"
          open={open}
          onClose={close}
          slotProps={{ paper: { "aria-label": "公開", sx: { maxHeight: "85vh", borderTopLeftRadius: 12, borderTopRightRadius: 12 } } }}
        >
          {content}
        </Drawer>
      ) : (
        <Popover
          open={open}
          anchorEl={anchor}
          onClose={close}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { "aria-label": "公開", sx: { width: 400, maxHeight: "calc(100vh - 64px)", mt: 0.5 } } }}
        >
          {content}
        </Popover>
      )}
    </>
  );
}
