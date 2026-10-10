import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import IconButton, { type IconButtonProps } from "@mui/material/IconButton";
import { useStars } from "../lib/stars";
import { Tooltip } from "./Tooltip";

/** スターの付け外し。付いているときは塗りつぶした星にし、ラベルでも状態を伝える。 */
export function StarButton({ pageId, title, iconSize = 20, sx }: { pageId: string; title?: string; iconSize?: number; sx?: IconButtonProps["sx"] }) {
  const { ids, toggle } = useStars();
  const starred = ids.includes(pageId);
  const label = starred ? "スターを外す" : "スターを付ける（サイドバーの上に出す）";
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={title ? `「${title}」${starred ? "のスターを外す" : "にスターを付ける"}` : label} aria-pressed={starred} onClick={() => toggle(pageId)} sx={sx}>
        {starred ? <StarIcon sx={{ fontSize: iconSize, color: "warning.main" }} /> : <StarBorderIcon sx={{ fontSize: iconSize }} />}
      </IconButton>
    </Tooltip>
  );
}
