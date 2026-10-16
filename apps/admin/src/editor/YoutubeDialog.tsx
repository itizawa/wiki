import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { parseYoutubeUrl } from "@wiki/shared";
import { useState } from "react";

/** YouTube の動画を入れるダイアログ。動画の URL を貼る。 */
export function YoutubeDialog(props: { open: boolean; onSubmit: (url: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const video = parseYoutubeUrl(text);
  const invalid = text.trim() !== "" && !video;
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="xs"
      // 閉じたあとのフォーカスは呼び出し側がエディタに戻す
      disableRestoreFocus
      slotProps={{ transition: { onExited: () => setText("") } }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (video) props.onSubmit(video.url);
        }}
      >
        <DialogTitle>YouTube の動画を挿入</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="動画のURL"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例：https://www.youtube.com/watch?v=..."
            error={invalid}
            helperText={
              invalid
                ? "YouTube の動画の URL（https://www.youtube.com/watch?v=… か https://youtu.be/… か https://www.youtube.com/shorts/…）を入れてください。"
                : "YouTube の動画の URL を貼ってください。再生位置（t=）は引き継ぎません。"
            }
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={props.onClose}>挿入しない</Button>
          <Button type="submit" variant="contained" disabled={!video}>
            動画を挿入
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
