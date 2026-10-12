import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { googleMapFromText } from "@wiki/shared";
import { useState } from "react";

/** Google マップを入れるダイアログ。地図の URL か、「共有」→「地図を埋め込む」の HTML を貼る。 */
export function GoogleMapDialog(props: { open: boolean; onSubmit: (url: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const map = googleMapFromText(text);
  const invalid = text.trim() !== "" && !map;
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
          if (map) props.onSubmit(map.url);
        }}
      >
        <DialogTitle>Google マップを挿入</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            margin="dense"
            label="地図のURLまたは埋め込み用のHTML"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例：https://www.google.com/maps/embed?pb=..."
            error={invalid}
            helperText={
              invalid
                ? "Google マップの URL（https://www.google.com/maps/… か https://maps.app.goo.gl/…）か、「共有」→「地図を埋め込む」の HTML を入れてください。"
                : map && !map.embedSrc
                  ? "この URL は地図に埋め込めないので、公開サイトではリンクで表示されます。「共有」→「地図を埋め込む」の HTML なら地図になります。"
                  : "Google マップの「共有」→「地図を埋め込む」の HTML を、そのまま貼れます。"
            }
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={props.onClose}>挿入しない</Button>
          <Button type="submit" variant="contained" disabled={!map}>
            地図を挿入
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
