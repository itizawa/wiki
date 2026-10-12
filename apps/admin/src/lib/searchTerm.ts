import { useEffect, useState, type CompositionEventHandler } from "react";

/** 打ち終わってから探しにいくまでの待ち時間（1文字ごとに問い合わせない）。 */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * 入力がいまの値になってから、探す語に反映するまでの待ち時間（ミリ秒）。null は「いまは反映しない」。
 *
 * - 空にしたときは待たない（候補の一覧の初期表示を、すぐ出す）
 * - 日本語入力などの変換中は反映しない（確定するまでに何度も変わる）。確定してから数え始める
 */
export function searchDelay(input: string, composing: boolean): number | null {
  if (input === "") return 0;
  return composing ? null : SEARCH_DEBOUNCE_MS;
}

/**
 * 入力欄の値から、検索に使う語を作る。打つのを止めてから `SEARCH_DEBOUNCE_MS` たつまでは、前の語のまま返す
 * （そのあいだ、`useQuery` の `placeholderData: keepPreviousData` で前の結果が出たままになる）。
 * 検索の画面・コマンドメニュー・本文の「@」のリンクの挿入が、同じこれを使う。
 *
 * @param composing 変換中か（`useComposition` か `useCompositionIn` で取る）
 */
export function useSearchTerm(input: string, composing = false): string {
  const [term, setTerm] = useState(input);
  const delay = searchDelay(input, composing);
  useEffect(() => {
    if (delay === null) return;
    if (delay === 0) return setTerm(input);
    const timer = setTimeout(() => setTerm(input), delay);
    return () => clearTimeout(timer);
  }, [input, delay]);
  return delay === 0 ? input : term;
}

/**
 * 入力欄が変換中かどうか。返ってきた `compositionProps` を `<input>` に渡す。
 * ブラウザによって、確定の文字が入る（input）のと変換が終わる（compositionend）のと、どちらが先かが違う。
 * どちらの順でも、変換が終わってから `useSearchTerm` が待ち時間を数え始める。
 */
export function useComposition(): {
  composing: boolean;
  compositionProps: { onCompositionStart: CompositionEventHandler; onCompositionEnd: CompositionEventHandler };
} {
  const [composing, setComposing] = useState(false);
  return { composing, compositionProps: { onCompositionStart: () => setComposing(true), onCompositionEnd: () => setComposing(false) } };
}

/**
 * React の外で作られた要素（Tiptap のエディタの本文）が変換中かどうか。
 * エディタは、変換中の文字も1文字ごとに本文へ反映する。`view.composing` は変わっても画面を描き直さないので、イベントで受ける。
 */
export function useCompositionIn(element: HTMLElement | null): boolean {
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (!element) return;
    const start = () => setComposing(true);
    const end = () => setComposing(false);
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    return () => {
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
      setComposing(false);
    };
  }, [element]);
  return composing;
}
