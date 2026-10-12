import { FileUp } from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useRef, useState } from "react";
import { DEFAULT_IMAGE_RULE, imageFileProblem, type ImageRule } from "../editor/imageFile";
import { api, errorMessage } from "../lib/api";
import { Muted } from "./ui";

/**
 * 選んだ・ドロップしたものから、アップロードする1枚を決める。
 * 画面の側で分かる理由（ファイルでない・2枚以上・形式・大きさ）で断るときは、その理由を返す。
 * 最終的な判定はサーバーが中身を見て行う。
 */
export function pickImageFile<F extends { type: string; size: number }>(files: readonly F[], rule: ImageRule = DEFAULT_IMAGE_RULE): { file: F } | { problem: string } {
  if (files.length === 0) return { problem: "画像のファイルを選んでください。文字やリンクはアップロードできません。" };
  if (files.length > 1) return { problem: "画像は1枚だけ選んでください。" };
  const file = files[0]!;
  const problem = imageFileProblem(file, rule);
  return problem ? { problem } : { file };
}

/**
 * 画像を1枚選んでアップロードする部品。ファイルの選択と、枠へのドラッグ＆ドロップの両方を受ける。
 * 受け付ける形式と大きさは、選ぶ前から枠の中に出しておく。アップロード中の表示とエラーも、この枠のそばに出す。
 * 終わったら、画像のパス（`/images/{name}`）を onUploaded に渡す。
 * 受け付ける形式と大きさ（`rule`）と送り先（`upload`）を省くと、本文の画像と同じ（PNG・JPEG・WebP・GIF の 5MB まで）。
 */
export function ImageUploader(props: {
  /** どの wiki の経路でアップロードするか。省くと、いま開いている wiki */
  wikiKey?: string;
  onUploaded: (url: string) => void;
  /** アップロード中かどうかが変わったとき（その間、保存のボタンを止めるのに使う） */
  onUploadingChange?: (uploading: boolean) => void;
  /** ファイルを選ぶボタンの文言 */
  label?: string;
  /** 受け付ける形式と大きさ。API の側の条件と合わせる */
  rule?: ImageRule;
  /** アップロードの送り先。省くと、wiki の画像（本文と同じ置き場所） */
  upload?: (file: File) => Promise<{ url: string }>;
}) {
  const rule = props.rule ?? DEFAULT_IMAGE_RULE;
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const startUpload = async (files: File[]) => {
    if (uploading) return;
    const picked = pickImageFile(files, rule);
    if ("problem" in picked) {
      setError(picked.problem);
      return;
    }
    setError(null);
    setUploading(true);
    props.onUploadingChange?.(true);
    try {
      const { url } = await (props.upload ? props.upload(picked.file) : api.uploadImage(picked.file, props.wikiKey));
      props.onUploaded(url);
    } catch (err) {
      setError(`画像をアップロードできませんでした。${errorMessage(err)}`);
    } finally {
      setUploading(false);
      props.onUploadingChange?.(false);
    }
  };

  return (
    <Box>
      <Box
        onDragOver={(e) => {
          // ここで止めないと、ブラウザがドロップしたファイルを開いてしまう
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={(e) => {
          // 枠の中の子へ移っただけのときは、そのままにする
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void startUpload(Array.from(e.dataTransfer.files));
        }}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.75,
          px: 2,
          py: 2,
          border: "1.5px dashed",
          borderColor: dragging ? "primary.main" : "divider",
          borderRadius: 1.5,
          bgcolor: dragging ? "action.hover" : "transparent",
          textAlign: "center",
        }}
      >
        {uploading ? (
          <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 36 }}>
            <CircularProgress size={18} />
            アップロード中…
          </Box>
        ) : (
          <Button variant="outlined" startIcon={<FileUp size={18} />} onClick={() => fileInput.current?.click()}>
            {props.label ?? "ファイルを選んでアップロード…"}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={rule.types.join(",")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // 同じファイルを続けて選んでも、もう一度アップロードできるようにする
            e.target.value = "";
            if (files.length > 0) void startUpload(files);
          }}
        />
        <Muted sx={{ fontSize: "0.8rem" }}>
          {dragging ? "ここにドロップするとアップロードします" : `この枠に画像をドラッグしても入れられます。${rule.limitLabel}。`}
        </Muted>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
