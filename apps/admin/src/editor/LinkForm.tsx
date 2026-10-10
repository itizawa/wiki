import { FileUp, Unlink } from "lucide-react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import type { Editor } from "@tiptap/react";
import { IMAGE_LIMIT_LABEL, IMAGE_TYPES } from "@wiki/shared";
import { useRef, useState } from "react";
import { Tooltip } from "../components/Tooltip";
import { Muted } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { imageFileProblem } from "./imageUpload";

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

/** 画像を入れるダイアログ。ファイルをアップロードするか、公開されている画像のURLを入れる。説明もここで入れる。 */
export function ImageDialog(props: { open: boolean; onSubmit: (image: { src: string; alt: string }) => void; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const href = normalizeHref(src);

  const upload = async (file: File) => {
    const problem = imageFileProblem(file);
    setUploadError(problem);
    if (problem) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      setSrc(url);
    } catch (err) {
      setUploadError(`画像をアップロードできませんでした。${errorMessage(err)}`);
    } finally {
      setUploading(false);
    }
  };
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
            setUploadError(null);
          },
        },
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (href && !uploading) props.onSubmit({ src: href, alt: alt.trim() });
        }}
      >
        <DialogTitle>画像を挿入</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Stack spacing={0.75} sx={{ alignItems: "flex-start" }}>
              <Button variant="outlined" startIcon={<FileUp size={18} />} disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? "アップロード中…" : "ファイルを選んでアップロード…"}
              </Button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={Object.keys(IMAGE_TYPES).join(",")}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
              <Muted sx={{ fontSize: "0.8rem" }}>
                {IMAGE_LIMIT_LABEL}。本文への貼り付けやドラッグでも入れられます。アップロードした画像は、URL を知っていればだれでも見られます（非公開のページに貼ったものも）。
              </Muted>
              {uploadError && (
                <Alert severity="error" sx={{ alignSelf: "stretch" }}>
                  {uploadError}
                </Alert>
              )}
            </Stack>
            <TextField
              autoFocus
              fullWidth
              label="画像のURL"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder="例：https://example.com/photo.png"
              helperText="アップロードすると自動で入ります。ほかのサイトで公開されている画像のURLを入れることもできます。"
            />
            <TextField
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
          <Button type="submit" variant="contained" disabled={!href || uploading}>
            画像を挿入
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
