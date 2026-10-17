/** 本文の左の余白（編集画面の本文の列の px。routes/EditorPage.tsx の `px: { xs: 2, md: 4 }`） */
export const EDITOR_GUTTER = { wide: 32, narrow: 16 } as const;

/**
 * ブロックをつかむハンドル（MarkdownEditor の BlockDragHandle）の大きさと、行の左端から左へずらす量。
 * - 広い画面: 空行の「挿入」ボタン（行の左 4px、幅 24px）と重ならないよう、さらに左へ置く
 * - 狭い画面（md 未満）: 余白が 16px しか無いので、ハンドルを細くして余白の中に収める（画面の左端からはみ出さない）。
 *   「挿入」ボタンは行の右端に出るので、重ならない
 */
export const BLOCK_HANDLE = {
  wide: { width: 24, icon: 18, offset: 28 },
  narrow: { width: 16, icon: 16, offset: 0 },
} as const;

/** ハンドルの左端が、本文の列の左端から何 px の所に来るか（負なら列の外＝画面の外へはみ出す） */
export const handleLeft = (size: "wide" | "narrow") => EDITOR_GUTTER[size] - BLOCK_HANDLE[size].width - BLOCK_HANDLE[size].offset;
