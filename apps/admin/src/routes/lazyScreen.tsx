import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import { CatchBoundary, lazyRouteComponent } from "@tanstack/react-router";
import { Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { LoadingRegion, PageBody } from "../components/ui";

/** 画面の JS（チャンク）を取れなかった。画面の中で起きたほかのエラーと見分けるための型。 */
export class ScreenLoadError extends Error {
  constructor(cause: unknown) {
    super("画面のファイルを読み込めませんでした", { cause });
    this.name = "ScreenLoadError";
  }
}

/** 読み込み中の、一覧・設定系の画面。見出しの行と、文の行（画面全体の読み込み中＝Layout の Loading の本文と同じ形）。 */
export function ScreenSkeleton() {
  return (
    <LoadingRegion>
      <Skeleton variant="text" width="34%" sx={{ fontSize: "1.5rem", mb: 1 }} />
      <Skeleton variant="text" />
      <Skeleton variant="text" />
      <Skeleton variant="text" width="60%" />
    </LoadingRegion>
  );
}

/**
 * 画面の JS を取れなかったときの表示。通信が切れているときと、新しい版が出て古いファイルが消えたときに起きる。
 * どちらも読み込み直せば開けるので、その手段を置く（新しい版のときは、読み込み直しで新しい index.html から取り直す）。
 * サイドバーは残るので、ほかの画面へはそのまま移れる。
 */
function ScreenLoadFailed({ error }: { error: unknown }) {
  // 画面の中で起きたエラーは、ここでは受けない（ルーターの既定の表示に任せる）
  if (!(error instanceof ScreenLoadError)) throw error;
  return (
    <Alert severity="error">
      <AlertTitle>この画面を読み込めませんでした</AlertTitle>
      通信が切れているか、管理画面が新しい版に替わっています。通信を確かめてから、画面を読み込み直してください。
      {/* ボタンは文の下に置く（横に置くと、スマホの幅では文の列が細くなる） */}
      <Box sx={{ mt: 1 }}>
        <Button color="inherit" variant="outlined" size="small" onClick={() => location.reload()}>
          画面を読み込み直す
        </Button>
      </Box>
    </Alert>
  );
}

function BareScreenLoadFailed(props: { error: unknown }) {
  return (
    <PageBody>
      <ScreenLoadFailed {...props} />
    </PageBody>
  );
}

/**
 * 画面を、開くときに読み込む（その画面の JS を別のファイルに分け、最初に読む JS から外す）。
 * 読み込みのあいだは `fallback` を出し、読み込めなかったら、その場に理由と「画面を読み込み直す」を出す。
 * `bare`：余白の枠（PageBody）に入れずに使う画面（画面いっぱいを使う編集系）。エラーの表示だけ、枠に入れて出す。
 *
 * 使うのは router.tsx だけ。ほかの所から画面のファイルを静的に import すると、その画面は最初に読む JS に戻る
 * （エディタが戻ると、vite.config.ts の wiki:first-load がビルドを止める）。
 */
export function lazyScreen<T extends Record<string, any>, K extends keyof T & string>(
  importer: () => Promise<T>,
  exportName: K,
  { fallback, bare = false }: { fallback: ReactNode; bare?: boolean },
): (props: ComponentProps<T[K]>) => ReactNode {
  const Lazy = lazyRouteComponent(
    // lazyRouteComponent は、チャンクが見つからないエラーだと画面を勝手に読み込み直す。
    // オフラインだとブラウザのエラー画面に替わってしまうので、別の型に包んで自分で表示する
    () =>
      importer().catch((err: unknown) => {
        throw new ScreenLoadError(err);
      }),
    exportName,
  ) as ComponentType<any>;
  const Failed = bare ? BareScreenLoadFailed : ScreenLoadFailed;
  return function LazyScreen(props) {
    return (
      <CatchBoundary getResetKey={() => exportName} errorComponent={Failed}>
        <Suspense fallback={fallback}>
          <Lazy {...props} />
        </Suspense>
      </CatchBoundary>
    );
  };
}
