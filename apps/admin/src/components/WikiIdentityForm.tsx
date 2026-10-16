import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { SITE_NAME_MAX, type WikiSummary } from "@wiki/shared";
import { useState, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import { useRefreshWikis } from "../lib/wiki";
import { HelpTip } from "./HelpTip";
import { ImageUploader } from "./ImageUploader";
import { Muted } from "./ui";
import { WikiIcon } from "./WikiIcon";

/** 表示名の欄の確かめ。空だと保存できない。 */
export function nameProblem(value: string): string | null {
  return value.trim() === "" ? "表示名を入れてください" : null;
}

type IdentityTarget = Pick<WikiSummary, "key" | "name" | "iconUrl">;

/**
 * wiki の表示名と画像の入力欄・確かめ・保存。「設定」の「一般」タブで使う。
 * 保存したら wiki の一覧（["wikis"]）を読み直し、サイドバーの切り替えメニューの表示名・アイコンにもすぐ映す。
 */
export function useWikiIdentityForm(wiki: IdentityTarget, opts: { onSaved?: (before: IdentityTarget, after: WikiSummary) => void } = {}) {
  const refreshWikis = useRefreshWikis();
  const [name, setName] = useState(wiki.name);
  const [iconUrl, setIconUrl] = useState(wiki.iconUrl ?? "");
  // 触る前から赤くしない。欄を離れたとき（または保存を試みたとき）から出す
  const [nameTouched, setNameTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const nextIcon = iconUrl.trim() === "" ? null : iconUrl.trim();
  const changed = name.trim() !== wiki.name || nextIcon !== wiki.iconUrl;
  const save = useMutation({
    mutationFn: () => api.updateWiki(wiki.key, { name: name.trim(), iconUrl: nextIcon }),
    onSuccess: async (w) => {
      await refreshWikis();
      opts.onSaved?.(wiki, w);
    },
  });
  const nameError = nameTouched ? nameProblem(name) : null;
  const canSave = nameProblem(name) === null && changed && !uploading && !save.isPending;

  const fields: ReactNode = (
    <Stack spacing={2.5}>
      <TextField
        label="表示名"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setNameTouched(true)}
        fullWidth
        required
        error={nameError !== null}
        helperText={nameError ?? undefined}
        slotProps={{
          htmlInput: { maxLength: SITE_NAME_MAX },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <HelpTip about="表示名">公開サイトの名前になります。変えても、key（{wiki.key}）と公開 URL は変わりません。</HelpTip>
              </InputAdornment>
            ),
          },
        }}
      />
      <Stack component="fieldset" spacing={1.5} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Box component="legend" sx={{ display: "flex", alignItems: "center", gap: 0.25, p: 0 }}>
          <Typography component="span" sx={{ fontWeight: 600 }}>
            画像（任意）
          </Typography>
          <HelpTip about="画像">サイドバーと wiki の切り替えで、表示名の頭文字の代わりに出します。正方形の画像がきれいに収まります。</HelpTip>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 40 }}>
          <Muted>見え方</Muted>
          {/* 選んだ画像で、実際に出る形を見せる（読み込めなければ頭文字になる） */}
          <WikiIcon key={nextIcon ?? ""} wiki={{ key: wiki.key, name: name.trim() || wiki.name, iconUrl: nextIcon }} size={28} />
          <WikiIcon key={`l${nextIcon ?? ""}`} wiki={{ key: wiki.key, name: name.trim() || wiki.name, iconUrl: nextIcon }} size={40} />
          {iconUrl !== "" && (
            <Button variant="text" onClick={() => setIconUrl("")} sx={{ ml: "auto" }}>
              画像を消す
            </Button>
          )}
        </Box>
        <ImageUploader wikiKey={wiki.key} onUploaded={setIconUrl} onUploadingChange={setUploading} />
        <Muted sx={{ fontSize: "0.8rem" }}>アップロードした画像は、URL を知っていればだれでも見られます。消すと頭文字に戻ります。</Muted>
      </Stack>
      {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
    </Stack>
  );

  return {
    fields,
    canSave,
    changed,
    saving: save.isPending,
    submit: () => {
      if (canSave) save.mutate();
    },
    /** 入力を、保存してある値に戻す */
    reset: () => {
      setName(wiki.name);
      setIconUrl(wiki.iconUrl ?? "");
      setNameTouched(false);
    },
  };
}
