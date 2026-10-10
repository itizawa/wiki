import { Star } from "lucide-react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { useStars } from "../lib/stars";
import { Tooltip } from "./Tooltip";

/** スターの付け外し。付いているときは塗りつぶした星にし、ラベルでも状態を伝える。 */
export function StarButton({ pageId, title }: { pageId: string; title?: string }) {
  const { ids, toggle } = useStars();
  const starred = ids.includes(pageId);
  const label = starred ? "スターを外す" : "スターを付ける（サイドバーの上に出す）";
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={title ? `「${title}」${starred ? "のスターを外す" : "にスターを付ける"}` : label} aria-pressed={starred} onClick={() => toggle(pageId)}>
        {starred ? <Box component={Star} size={18} fill="currentColor" sx={{ color: "warning.main" }} /> : <Star size={18} />}
      </IconButton>
    </Tooltip>
  );
}
