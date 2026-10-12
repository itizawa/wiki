import Box from "@mui/material/Box";
import { useState } from "react";
import { wikiColor } from "../lib/wikiColor";
import { pickWikiIconUrl, wikiIconCandidates } from "../lib/wikiIconSource";

/**
 * wiki の画像（アイコン）。画像が無いとき・読み込めないときは、表示名の頭文字を出す。
 * `preferFavicon` のときは、外観のファビコン（`faviconUrl`）を先に出し、無い・読み込めないなら一般設定の画像（`iconUrl`）に落とす。
 * 渡さないときは `faviconUrl` があっても使わない（切り替え以外の場所は、一般設定の画像と頭文字のまま）。
 * 頭文字の四角は、wiki ごとに色を変える（key から決める）。頭文字が同じ wiki も、並んだときに見分けられる。
 * 飾りとして扱い、読み上げには wiki の表示名（そばに出している）を使う。
 */
export function WikiIcon({
  wiki,
  size = 28,
  preferFavicon = false,
}: {
  wiki: { key: string; name: string; iconUrl: string | null; faviconUrl?: string | null };
  size?: number;
  preferFavicon?: boolean;
}) {
  // 失敗した URL を覚えておく（URL が変われば、もう一度読み込みを試す）
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const url = pickWikiIconUrl(wikiIconCandidates(wiki, preferFavicon), failed);
  const box = { width: size, height: size, flexShrink: 0, borderRadius: 1 } as const;

  if (url) {
    return (
      <Box
        component="img"
        src={url}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        onError={() => setFailed((prev) => new Set(prev).add(url))}
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
