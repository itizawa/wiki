import Box from "@mui/material/Box";
import { useState } from "react";
import { wikiColor } from "../lib/wikiColor";

/**
 * wiki の画像（アイコン）。画像が無いとき・読み込めないときは、表示名の頭文字を出す。
 * 頭文字の四角は、wiki ごとに色を変える（key から決める）。頭文字が同じ wiki も、並んだときに見分けられる。
 * 飾りとして扱い、読み上げには wiki の表示名（そばに出している）を使う。
 */
export function WikiIcon({ wiki, size = 28 }: { wiki: { key: string; name: string; iconUrl: string | null }; size?: number }) {
  // 失敗した URL を覚えておく（URL が変われば、もう一度読み込みを試す）
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = { width: size, height: size, flexShrink: 0, borderRadius: 1 } as const;

  if (wiki.iconUrl && wiki.iconUrl !== failedUrl) {
    return (
      <Box
        component="img"
        src={wiki.iconUrl}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(wiki.iconUrl)}
        sx={{ ...box, display: "block", objectFit: "cover" }}
      />
    );
  }
  return (
    <Box
      aria-hidden
      sx={{
        ...box,
        display: "grid",
        placeItems: "center",
        bgcolor: wikiColor(wiki.key),
        color: "#fff",
        fontWeight: 700,
        fontSize: `${(size / 28) * 0.9}rem`,
      }}
    >
      {wiki.name.slice(0, 1).toUpperCase()}
    </Box>
  );
}
