import { useSyncExternalStore } from "react";

/**
 * 値の一部だけを見て描き直すための、小さな入れ物。
 * 行がたくさんある一覧で、「どの行が選ばれているか」のような値を props や context で配ると、変わるたびに全部の行を描き直す。
 * ここに入れて `useSelect` で読むと、読んだ結果が変わった行だけを描き直す。
 */
export type SelectStore<S> = {
  get: () => S;
  /** 一部を入れ替える。どの値も変わらなければ、何も知らせない */
  set: (patch: Partial<S>) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createSelectStore<S extends object>(initial: S): SelectStore<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const keys = Object.keys(patch) as (keyof S)[];
      if (keys.every((key) => Object.is(state[key], patch[key]))) return;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * 入れ物から値を選んで読む。選んだ結果（`Object.is` で比べる）が変わったときだけ描き直す。
 * `select` は、同じ中身なら同じ値を返すこと（その場で配列やオブジェクトを作って返さない）。
 */
export function useSelect<S, T>(store: SelectStore<S>, select: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
