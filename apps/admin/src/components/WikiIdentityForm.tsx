import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { isWikiIconUrl, SITE_NAME_MAX, WIKI_ICON_URL_MAX, type WikiSummary } from "@wiki/shared";
import { useState, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import { useRefreshWikis } from "../lib/wiki";
import { HelpTip } from "./HelpTip";
import { ImageUploader } from "./ImageUploader";
import { Muted } from "./ui";
import { WikiIcon } from "./WikiIcon";

/** 画像の URL の欄の確かめ。空なら「画像なし」。 */
export function iconUrlProblem(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (v.length > WIKI_ICON_URL_MAX) return `URL が長すぎます（${WIKI_ICON_URL_MAX}文字まで）`;
  if (!isWikiIconUrl(v)) return "http:// か https:// で始まる URL を入れてください";
  return null;
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
  const [uploading, setUploading] = useState(false);
  const nextIcon = iconUrl.trim() === "" ? null : iconUrl.trim();
  const problem = iconUrlProblem(iconUrl);
  const changed = name.trim() !== wiki.name || nextIcon !== wiki.iconUrl;
  const save = useMutation({
    mutationFn: () => api.updateWiki(wiki.key, { name: name.trim(), iconUrl: nextIcon }),
    onSuccess: async (w) => {
      await refreshWikis();
      opts.onSaved?.(wiki, w);
    },
  });
  const canSave = Boolean(name.trim()) && problem === null && changed && !uploading && !save.isPending;

  const fields: ReactNode = (
    <Stack spacing={2.5}>
      <TextField
        label="表示名"
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
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
          {/* 入力中の URL で、実際に出る形を見せる（読み込めなければ頭文字になる） */}
          <WikiIcon key={nextIcon ?? ""} wiki={{ key: wiki.key, name: name.trim() || wiki.name, iconUrl: problem ? null : nextIcon }} size={28} />
          <WikiIcon key={`l${nextIcon ?? ""}`} wiki={{ key: wiki.key, name: name.trim() || wiki.name, iconUrl: problem ? null : nextIcon }} size={40} />
          {iconUrl !== "" && (
            <Button variant="text" onClick={() => setIconUrl("")} sx={{ ml: "auto" }}>
              画像を外す
            </Button>
          )}
        </Box>
        <ImageUploader wikiKey={wiki.key} onUploaded={setIconUrl} onUploadingChange={setUploading} />
        <TextField
          label="画像の URL"
          value={iconUrl}
          onChange={(e) => setIconUrl(e.target.value)}
          fullWidth
          placeholder="https://example.com/icon.png"
          error={problem !== null}
          // 条件（だれでも見られること）は、選ぶ前から出しておく
          helperText={problem ?? "アップロードした画像は、URL を知っていればだれでも見られます。"}
          slotProps={{
            htmlInput: { maxLength: WIKI_ICON_URL_MAX, inputMode: "url", spellCheck: false },
            inputLabel: { shrink: true },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <HelpTip about="画像の URL">アップロードすると自動で入ります。ほかのサイトで公開されている画像の URL を入れることもできます。空にすると頭文字に戻ります。</HelpTip>
                </InputAdornment>
              ),
            },
          }}
        />
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
    },
  };
}
