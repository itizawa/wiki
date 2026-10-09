import { useCallback, useState } from "react";

/** localStorage に残す画面の状態（サイドバーの開閉など）。保存できない環境では、その場かぎりの状態として動く。 */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 保存できなくても表示は続ける
      }
    },
    [key],
  );
  return [value, set];
}
