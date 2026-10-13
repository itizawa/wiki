import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Popover from "@mui/material/Popover";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { ImagePlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { COVER_PRESETS, COVER_UPLOAD_LIMIT_LABEL, COVER_UPLOAD_TYPES, IMAGE_MAX_BYTES, coverPresetPath, findCoverPreset, type PageDetail } from "@wiki/shared";
import { useEffect, useState } from "react";
import type { ImageRule } from "../editor/imageFile";
import { api, errorMessage } from "../lib/api";
import { ImageUploader } from "./ImageUploader";

/** カバーの高さ（px）。画像の読み込みで本文が下へずれないよう、固定にする（公開サイトも同じ考え方） */
const COVER_HEIGHT = { xs: 120, sm: 200 };

/** カバーにアップロードできる画像。本文の画像と同じ上限で、動く GIF だけ除く */
const COVER_RULE: ImageRule = { types: COVER_UPLOAD_TYPES, maxBytes: IMAGE_MAX_BYTES, limitLabel: COVER_UPLOAD_LIMIT_LABEL };

/** パスから、画像の説明に使う名前（用意した画像のときだけ） */
const coverName = (cover: string) => findCoverPreset(cover)?.name;

/**
 * 編集画面の、タイトルの上のカバー。
 * - 付いていない：「カバーを追加」を控えめに出す（押すとカバーを選ぶ画面を開く）
 * - 付いている：横長の画像（高さは固定、中央を切り抜いて出す）と、「カバーを変更」「カバーを削除」。
 *   2つは離して右下に置き、削除は赤にしない（外してもまた選べるので、取り返しはつく）
 * 選ぶ画面は `PageCoverPicker`。この部品の下に置く `anchorEl` を渡す。
 */
export function PageCover(props: { cover: string | null; onPick: () => void; onRemove: () => void; removing: boolean; error: string | null }) {
  const { cover } = props;
  if (cover === null) {
    return (
      <Box sx={{ mb: 1 }}>
        <Button size="small" color="inherit" startIcon={<ImagePlus size={16} />} onClick={props.onPick} aria-haspopup="dialog" sx={{ color: "text.secondary" }}>
          カバーを追加
        </Button>
        {props.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {props.error}
          </Alert>
        )}
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ position: "relative", height: COVER_HEIGHT, borderRadius: 1.5, overflow: "hidden", bgcolor: "action.hover" }}>
        {/* 飾りなので alt は空。選んだ名前は「変更」のボタンの説明に出す */}
        <Box component="img" src={cover} alt="" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
        <Box sx={{ position: "absolute", right: 8, bottom: 8, display: "flex", gap: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            color="inherit"
            onClick={props.onPick}
            aria-haspopup="dialog"
            aria-label={coverName(cover) ? `カバーを変更（いまは「${coverName(cover)}」）` : "カバーを変更"}
            sx={{ bgcolor: "background.paper", color: "text.primary", "&:hover": { bgcolor: "background.paper" } }}
          >
            カバーを変更
          </Button>
          <Button
            size="small"
            variant="contained"
            color="inherit"
            disabled={props.removing}
            onClick={props.onRemove}
            sx={{ bgcolor: "background.paper", color: "text.primary", "&:hover": { bgcolor: "background.paper" } }}
          >
            カバーを削除
          </Button>
        </Box>
      </Box>
      {props.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {props.error}
        </Alert>
      )}
    </Box>
  );
}

/**
 * カバーを選ぶ画面。「ギャラリー」（用意した画像から選ぶ）と「アップロード」（自分の画像を入れる）の2つ。
 * 選んだ・アップロードが終わったら、すぐに保存して閉じる（アイコンと同じ。本文の保存とは別）。
 */
export function PageCoverPicker(props: { pageId: string; cover: string | null; anchorEl: HTMLElement | null; open: boolean; onClose: () => void }) {
  const { pageId, cover, open, onClose } = props;
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");
  const save = useSetCover(pageId, onClose);

  // 開くたびに、ギャラリーから始め、前のエラーを残さない
  useEffect(() => {
    if (open) {
      setTab("gallery");
      save.reset();
    }
  }, [open]);

  const choose = (next: string) => {
    if (next === cover) onClose();
    else save.mutate(next);
  };

  return (
    <Popover
      open={open}
      anchorEl={props.anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{ paper: { role: "dialog", "aria-label": "ページのカバーを選ぶ", sx: { width: 420, maxWidth: "calc(100vw - 32px)", mt: 0.5 } } }}
    >
      <Tabs value={tab} onChange={(_, v: "gallery" | "upload") => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab value="gallery" label="ギャラリー" id="cover-tab-gallery" aria-controls="cover-panel" />
        <Tab value="upload" label="アップロード" id="cover-tab-upload" aria-controls="cover-panel" />
      </Tabs>
      <Box id="cover-panel" role="tabpanel" aria-labelledby={`cover-tab-${tab}`} sx={{ p: 1.5 }}>
        {save.error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            カバーを保存できませんでした：{errorMessage(save.error)}
          </Alert>
        )}
        {tab === "gallery" ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1 }}>
            {COVER_PRESETS.map((preset) => {
              const path = coverPresetPath(preset.key);
              const current = path === cover;
              return (
                <ButtonBase
                  key={preset.key}
                  aria-label={preset.name}
                  aria-pressed={current}
                  disabled={save.isPending}
                  onClick={() => choose(path)}
                  sx={{
                    position: "relative",
                    display: "block",
                    height: 64,
                    borderRadius: 1,
                    overflow: "hidden",
                    outline: current ? "2px solid" : "1px solid",
                    outlineColor: current ? "primary.main" : "divider",
                    "&:hover, &.Mui-focusVisible": { outlineColor: "primary.main" },
                  }}
                >
                  <Box component="img" src={path} alt="" sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                  <Box
                    component="span"
                    sx={{ position: "absolute", left: 4, bottom: 4, px: 0.75, borderRadius: 0.5, bgcolor: "background.paper", color: "text.primary", fontSize: "0.75rem", lineHeight: 1.6 }}
                  >
                    {preset.name}
                    {current && "（選択中）"}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
        ) : (
          <ImageUploader
            label="画像を選んでアップロード…"
            rule={COVER_RULE}
            onUploaded={(url) => save.mutate(url)}
          />
        )}
      </Box>
    </Popover>
  );
}

/**
 * カバーを保存する（付ける・変える・外す）。編集中の内容や版には触れず、ページのカバーだけを入れ替える。
 * `onDone` は、保存できたあとに呼ぶ。
 */
export function useSetCover(pageId: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: string | null) => api.setPageCover(pageId, next),
    onSuccess: (page) => {
      qc.setQueryData<PageDetail>(["page", pageId], (old) => (old ? { ...old, cover: page.cover } : old));
      void qc.invalidateQueries({ queryKey: ["pages"] });
      onDone?.();
    },
  });
}
