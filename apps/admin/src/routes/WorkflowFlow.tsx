import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import { ArrowDown, ChevronDown, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

/**
 * ワークフローのブロックを「トリガー → アクション」の流れで見せる、カードと矢印。
 * 一覧（読むだけ）と、編集のダイアログ（押すと編集欄が開く）の両方で使う。
 */

/** カードとカードのあいだの、下向きの矢印（流れの向き）。読み上げには出さない（順番は ol と見出しで伝わる） */
export function FlowConnector({ dense }: { dense?: boolean }) {
  return (
    <Box aria-hidden sx={{ display: "flex", flexDirection: "column", alignItems: "center", color: "text.disabled", py: dense ? 0.25 : 0.5 }}>
      <Box sx={{ width: "2px", height: dense ? 8 : 12, bgcolor: "divider" }} />
      <ArrowDown size={dense ? 14 : 16} />
    </Box>
  );
}

type FlowCardProps = {
  icon: LucideIcon;
  /** 小さく出す、カードの役割（「トリガー」「2 番目のアクション」） */
  kind: string;
  /** カードの要約（「タグ「校正待ち」が付いたとき」） */
  summary: string;
  /** 要約の下の補足（依頼の先頭など） */
  detail?: string | null;
  /** 選び終えていない欄がある（要約の文でも「未設定」と言う。色だけに頼らない） */
  incomplete?: boolean;
  /** トリガーとアクションで、アイコンの地の色を変える */
  tone?: "trigger" | "action";
  dense?: boolean;
  /** 開閉できるカード（編集のダイアログ）。渡さなければ読むだけのカード */
  expanded?: boolean;
  onToggle?: () => void;
  /** 見出しの左（ドラッグのつまみ）と右（上へ・下へ・取り除く、説明）に置く操作。開閉のボタンの外に置く */
  start?: ReactNode;
  end?: ReactNode;
  /** 狭い幅（スマホ）では、右の操作を見出しの下の段に回す。操作が多く、要約の幅が取れないカードで使う */
  wrapEnd?: boolean;
  /** 開いたときの編集欄 */
  children?: ReactNode;
};

export function FlowCard({ icon: Icon, kind, summary, detail, incomplete, tone = "action", dense, expanded, onToggle, start, end, wrapEnd, children }: FlowCardProps) {
  const contentId = useId();
  const toggleable = onToggle !== undefined;
  const body = (
    <>
      <Box
        aria-hidden
        sx={{
          flex: "none",
          width: dense ? 28 : 34,
          height: dense ? 28 : 34,
          borderRadius: 1,
          display: "grid",
          placeItems: "center",
          bgcolor: tone === "trigger" ? "primary.main" : "action.selected",
          color: tone === "trigger" ? "primary.contrastText" : "text.primary",
        }}
      >
        <Icon size={dense ? 16 : 18} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, textAlign: "left" }}>
        <Typography variant="caption" component="span" sx={{ display: "block", color: "text.secondary", lineHeight: 1.4 }}>
          {kind}
        </Typography>
        <Typography component="span" sx={{ display: "block", fontWeight: 600, overflowWrap: "anywhere", color: incomplete ? "warning.dark" : "text.primary", fontSize: dense ? 14 : undefined }}>
          {summary}
        </Typography>
        {detail && (
          <Typography variant="body2" component="span" sx={{ display: "block", color: "text.secondary", overflowWrap: "anywhere" }}>
            {detail}
          </Typography>
        )}
      </Box>
      {toggleable && (
        <Box aria-hidden sx={{ flex: "none", color: "text.secondary", display: "grid", transition: "transform 150ms", transform: expanded ? "rotate(180deg)" : "none" }}>
          <ChevronDown size={18} />
        </Box>
      )}
    </>
  );
  return (
    <Box
      sx={{
        border: 1,
        borderColor: expanded ? "primary.main" : incomplete ? "warning.main" : "divider",
        borderStyle: incomplete && !expanded ? "dashed" : "solid",
        borderRadius: 1.5,
        bgcolor: "background.paper",
        boxShadow: toggleable ? 1 : 0,
      }}
    >
      <Box sx={{ display: "flex", flexWrap: wrapEnd ? { xs: "wrap", sm: "nowrap" } : "nowrap", alignItems: "center", gap: 0.5, pl: start ? 0.5 : 0, pr: end ? 0.5 : 0 }}>
        {start}
        {toggleable ? (
          <ButtonBase
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={contentId}
            sx={{ flex: "1 1 0", minWidth: wrapEnd ? { xs: "calc(100% - 48px)", sm: 0 } : 0, display: "flex", alignItems: "center", gap: 1.25, p: 1.25, pl: start ? 0.5 : 1.25, borderRadius: 1.5, justifyContent: "flex-start", "&:hover": { bgcolor: "action.hover" } }}
          >
            {body}
          </ButtonBase>
        ) : (
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1, p: dense ? 0.75 : 1.25 }}>{body}</Box>
        )}
        {end && (wrapEnd ? <Box sx={{ display: "flex", justifyContent: "flex-end", width: { xs: "100%", sm: "auto" }, mt: { xs: -1, sm: 0 }, pb: { xs: 0.5, sm: 0 } }}>{end}</Box> : end)}
      </Box>
      {toggleable && (
        <Collapse in={expanded}>
          <Box id={contentId} sx={{ px: 1.5, pb: 1.5, pt: 0.5, display: "grid", gap: 1.5 }}>
            {children}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}
