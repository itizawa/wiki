import { Unlink } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import type { Editor } from "@tiptap/react";
import { useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { ImageUploader } from "../components/ImageUploader";
import { Field, Muted } from "../components/ui";

/**
 * 入力されたリンク先を整える。`example.com` のようにスキームが無ければ https:// を補う。
 * ページ内（#）・サイト内（/）・mailto: などはそのまま通す。空なら null。
 */
export function normalizeHref(input: string): string | null {
  const v = input.trim();
  if (v === "") return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(v)) return v;
  return `https://${v}`;
}

/** 書式メニューの中で、リンク先を入れる行。Enter で設定、Esc で書式メニューに戻る。 */
export function LinkForm(props: { initial: string; onSubmit: (href: string) => void; onRemove?: () => void; onClose: () => void }) {
  const [value, setValue] = useState(props.initial);
  const href = normalizeHref(value);
  return (
    <Stack
      direction="row"
      component="form"
      aria-label="リンク"
      onSubmit={(e) => {
        e.preventDefault();
        if (href) props.onSubmit(href);
      }}
      sx={{ alignItems: "center", gap: 0.5, p: 0.5, pl: 1.25 }}
    >
      <InputBase
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          }
        }}
        placeholder="例：https://example.com"
        inputProps={{ "aria-label": "リンク先のURL" }}
        sx={{ width: 260, fontSize: "0.9rem" }}
      />
      <Button type="submit" variant="contained" disabled={!href}>
        リンクを設定
      </Button>
      {props.onRemove && (
        <Tooltip title="リンクを外す">
          <IconButton size="small" aria-label="リンクを外す" onClick={props.onRemove} sx={{ borderRadius: 1, ml: 0.5 }}>
            <Unlink size={18} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

/** カーソルの位置に画像を入れる。 */
export function insertImage(editor: Editor, image: { src: string; alt: string }) {
  // 画像の下に空行を足してカーソルを置く（画像が選択されたままだと、次に打った文字で画像が置き換わるため）
  editor.chain().focus().insertContent([{ type: "image", attrs: image }, { type: "paragraph" }]).run();
}

/** 画像を入れるダイアログ。ファイルをアップロードして入れる（URL の入力はできない）。説明もここで入れる。 */
export function ImageDialog(props: { open: boolean; onSubmit: (image: { src: string; alt: string }) => void; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="xs"
      // 閉じたあとのフォーカスは呼び出し側がエディタに戻す
      disableRestoreFocus
      slotProps={{
        transition: {
          onExited: () => {
            setSrc("");
            setAlt("");
          },
        },
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (src && !uploading) props.onSubmit({ src, alt: alt.trim() });
        }}
      >
        <DialogTitle>画像を挿入</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Stack spacing={0.75}>
              <ImageUploader onUploaded={setSrc} onUploadingChange={setUploading} label={src ? "別のファイルを選んでアップロード…" : undefined} />
              {src && !uploading && (
                <Box component="img" src={src} alt="アップロードした画像" sx={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain", alignSelf: "center", borderRadius: 1 }} />
              )}
              <Muted sx={{ fontSize: "0.8rem" }}>本文への貼り付けやドラッグでも入れられます。アップロードした画像は、URL を知っていればだれでも見られます（非公開のページに貼ったものも）。</Muted>
            </Stack>
            <Field
              fullWidth
              label="画像の説明（任意）"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="例：管理画面のスクリーンショット"
              helperText="画像を表示できないときや、読み上げのときに使われます。"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={props.onClose}>挿入しない</Button>
          <Button type="submit" variant="contained" disabled={!src || uploading}>
            画像を挿入
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
