import { X } from "lucide-react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { useEffect, useSyncExternalStore } from "react";
import { monoFont } from "../theme";
import { Tooltip } from "./Tooltip";

const listeners = new Set<() => void>();
let isOpen = false;
const setOpen = (next: boolean) => {
  isOpen = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** ガイドを開く（左下のユーザーメニューから呼ぶ）。 */
export const openShortcutGuide = () => setOpen(true);

/** 文字を打ち込む場所（入力欄や本文）にいるか。そこでの「?」は文字として扱う。 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  return target.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "");
}

type Entry = { keys: string[]; label: string };
type Group = { title: string; entries: Entry[] };

/** 一覧の中身。`mod` は Mac なら ⌘、それ以外は Ctrl。 */
export function shortcutGroups(mod: string): Group[] {
  return [
    {
      title: "画面",
      entries: [
        { keys: ["?"], label: "このガイドを開く" },
        { keys: [mod, "K"], label: "コマンドメニューを開く（ページを探す・画面を移る）" },
        { keys: [mod, "."], label: "サイドバーを開く／閉じる" },
        { keys: [mod, "S"], label: "編集中の内容を版として残す" },
        { keys: [mod, "F"], label: "本文を検索・置換する（編集画面で）" },
      ],
    },
    {
      title: "キーボードだけで移る",
      entries: [
        { keys: ["Tab"], label: "画面を開いて最初に押すと「本文へ移る」が出る。Enter で本文へ移る" },
        { keys: ["↑", "↓"], label: "サイドバーのツリーで、前後のページへ移る（Tab で入れるのは1行だけ）" },
        { keys: ["→", "←"], label: "ツリーで、ひらく・子のページへ／たたむ・親のページへ" },
        { keys: ["Home", "End"], label: "ツリーの先頭／末尾のページへ" },
        { keys: ["Enter"], label: "ツリーで、そのページを開く" },
        { keys: ["Shift", "Enter"], label: "ツリーで、そのページの下に新しいページを作る" },
        { keys: ["Shift", "F10"], label: "ツリーで、そのページの「…」メニューを開く（メニューキーでも同じ）" },
      ],
    },
    {
      title: "本文で打つと出るメニュー",
      entries: [
        { keys: ["/"], label: "ブロックを挿入する（見出し・表・画像など）" },
        { keys: ["@"], label: "ほかのページへのリンクを入れる（[[ でも同じ）" },
      ],
    },
    {
      title: "本文の書式",
      entries: [
        { keys: [mod, "B"], label: "太字" },
        { keys: [mod, "I"], label: "斜体" },
        { keys: [mod, "Shift", "S"], label: "取り消し線" },
        { keys: [mod, "E"], label: "インラインコード" },
        { keys: [mod, "Z"], label: "元に戻す" },
        { keys: [mod, "Shift", "Z"], label: "やり直す" },
        { keys: ["Tab"], label: "リストを1段下げる（Shift+Tab で上げる）" },
      ],
    },
    {
      title: "Markdown の記法（行頭で打つとその場で変わる）",
      entries: [
        { keys: ["#", "空白"], label: "見出し1（## で見出し2、### で見出し3）" },
        { keys: ["-", "空白"], label: "箇条書き" },
        { keys: ["1.", "空白"], label: "番号つきリスト" },
        { keys: ["[ ]", "空白"], label: "チェックリスト" },
        { keys: [">", "空白"], label: "引用" },
        { keys: ["```", "空白"], label: "コードブロック" },
        { keys: ["---"], label: "区切り線" },
      ],
    },
    {
      title: "Markdown の記法（文の途中で囲む）",
      entries: [
        { keys: ["**太字**"], label: "太字" },
        { keys: ["*斜体*"], label: "斜体" },
        { keys: ["~~取り消し~~"], label: "取り消し線" },
        { keys: ["`code`"], label: "インラインコード" },
      ],
    },
    {
      title: "プレゼンモード（編集画面の「…」メニューから始める）",
      entries: [
        { keys: ["Space / → / PageDown"], label: "次のスライド" },
        { keys: ["← / PageUp"], label: "前のスライド" },
        { keys: ["Home / End"], label: "最初／最後のスライド" },
        { keys: ["F"], label: "全画面表示にする／やめる" },
        { keys: ["Esc"], label: "全画面ならやめる。全画面でなければプレゼンモードを終了" },
      ],
    },
  ];
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** ショートカットの修飾キーの表示。Mac なら ⌘、それ以外は Ctrl。 */
export const modKey = () => (isMac() ? "⌘" : "Ctrl");

/** キーボードショートカットと Markdown 記法の一覧。「?」か、サイドバー下のキーボードのボタンで開く。 */
export function ShortcutGuide() {
  const open = useSyncExternalStore(subscribe, () => isOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target as HTMLElement | null)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="shortcut-guide-title">
      <DialogTitle id="shortcut-guide-title" sx={{ display: "flex", alignItems: "center" }}>
        <Box component="span" sx={{ flex: 1 }}>
          キーボードショートカットと記法
        </Box>
        <Tooltip title="閉じる (Esc)">
          <IconButton size="small" aria-label="閉じる" onClick={() => setOpen(false)}>
            <X size={18} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        {shortcutGroups(modKey()).map((group) => (
          <Box key={group.title} component="section" sx={{ mb: 2.5, "&:last-of-type": { mb: 0 } }}>
            <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5, color: "text.secondary" }}>
              {group.title}
            </Typography>
            <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(120px, max-content) 1fr", columnGap: 2, rowGap: 0.75, alignItems: "baseline" }}>
              {group.entries.map((entry) => (
                <Box key={entry.label} sx={{ display: "contents" }}>
                  <Box component="dt" sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {entry.keys.map((k) => (
                      <Box
                        key={k}
                        component="kbd"
                        sx={{ px: 0.75, py: 0.125, border: 1, borderColor: "divider", borderRadius: 0.5, bgcolor: "background.default", fontFamily: monoFont, fontSize: "0.8rem", whiteSpace: "nowrap" }}
                      >
                        {k}
                      </Box>
                    ))}
                  </Box>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {entry.label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}
