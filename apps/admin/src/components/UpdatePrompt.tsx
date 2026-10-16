import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import { useRegisterSW } from "virtual:pwa-register/react";
import { UPDATE_PROMPT_BUTTON_MIN_HEIGHT, updatePromptZIndex } from "./updatePromptStyle";

/** 開いたままの画面で、新しい版が出ていないかを確かめる間隔。 */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Service Worker を登録し、新しい版がデプロイされたら知らせる。
 * 勝手には切り替えない（書いている途中で画面が読み込み直されないように）。「更新する」を押したときだけ切り替える。
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {});
      };
      // 管理画面は開いたままにされるので、ときどき確かめる。スマホでは、裏から戻ったときにも確かめる
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  const update = () => {
    // 初めて開いた画面は、まだ Service Worker を通っていない。新しい版はもう有効になっているので、読み込み直すだけでよい
    if (!navigator.serviceWorker.controller) location.reload();
    else void updateServiceWorker(true);
  };

  return (
    <Snackbar open={needRefresh} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} sx={{ zIndex: updatePromptZIndex }}>
      {/* ボタンは文の下に並べる（横に置くと、スマホの幅ではボタンの文字が折り返す） */}
      <Alert severity="info" variant="filled" icon={false}>
        新しい版があります。更新すると、画面を読み込み直します。
        <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: "flex-end" }}>
          <Button color="inherit" sx={{ minHeight: UPDATE_PROMPT_BUTTON_MIN_HEIGHT }} onClick={() => setNeedRefresh(false)}>
            あとで
          </Button>
          <Button color="inherit" variant="outlined" sx={{ minHeight: UPDATE_PROMPT_BUTTON_MIN_HEIGHT }} onClick={update}>
            更新する
          </Button>
        </Stack>
      </Alert>
    </Snackbar>
  );
}
