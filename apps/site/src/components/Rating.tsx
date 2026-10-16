import { RATING_MAX, ratingBarWidths, type RatingSummary } from "@wiki/shared";
import { Star } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { applyRating, fetchRating, raterId, sendRating } from "../lib/rating";
import s from "./Rating.module.css";

const SCORES = Array.from({ length: RATING_MAX }, (_, i) => i + 1);
const LABELS = ["", "いまいち", "もう少し", "ふつう", "よい", "とてもよい"];

/**
 * ページの評価（星1〜5）。だれでもログインせずに付けられ、付け直せる。ほかの人の評価は、星ごとの件数の横棒グラフで出す。
 * 本文の `@rating` の位置に置く（RatingEmbeds）。中身はブラウザで API から読み、読めなければ（404・通信の失敗）欄ごと出さない。
 */
export default function Rating({ pageId }: { pageId: string }) {
  const [summary, setSummary] = useState<RatingSummary | null | undefined>(undefined);
  const [rater, setRater] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();
  /** サーバーが最後に返した評価。送るのに失敗したら、星をここへ戻す */
  const confirmed = useRef<RatingSummary | null>(null);
  /** 送った回数。続けて付け直したとき、最後に送った分の返事だけを反映する */
  const sent = useRef(0);

  useEffect(() => {
    const rater = raterId(typeof localStorage === "undefined" ? undefined : localStorage, () => crypto.randomUUID());
    setRater(rater);
    let active = true;
    void fetchRating(fetch, pageId, rater).then((r) => {
      if (!active) return;
      confirmed.current = r;
      setSummary(r);
    });
    return () => {
      active = false;
    };
  }, [pageId]);

  if (summary === null) return null;

  // 星は押したらすぐ変える（楽観的更新）。送るのに失敗したら、サーバーが最後に返した評価へ戻す
  const rate = async (score: number) => {
    if (!rater || !summary) return;
    const seq = ++sent.current;
    setSummary(applyRating(summary, score));
    setMessage("評価しました。ありがとうございます");
    const result = await sendRating(fetch, pageId, rater, score);
    if (result.ok) confirmed.current = result.summary;
    if (seq !== sent.current) return;
    if (result.ok) setSummary(result.summary);
    else {
      setSummary(confirmed.current);
      setMessage(result.message);
    }
  };

  const mine = summary?.mine ?? null;
  const shown = hover ?? mine ?? 0;
  const widths = ratingBarWidths(summary?.counts ?? [0, 0, 0, 0, 0]);

  return (
    <section className={s.rating} aria-labelledby={`${id}-heading`} aria-busy={summary === undefined} data-pagefind-ignore>
      <h2 id={`${id}-heading`}>評価</h2>
      <div className={s.layout}>
        <div className={s.overall}>
          <p className={s.average}>{summary?.average?.toFixed(1) ?? "–"}</p>
          <Stars value={summary?.average ?? 0} />
          <p className={s.total}>{summary ? `${summary.total}件の評価` : "読み込み中…"}</p>
        </div>
        <ol className={s.bars} aria-label="星ごとの評価の数">
          {[...SCORES].reverse().map((score) => {
            const count = summary?.counts[score - 1] ?? 0;
            return (
              <li key={score} className={s.bar}>
                <span className={s.barLabel}>
                  {score}
                  <Star size={12} aria-hidden="true" className={s.barStar} />
                </span>
                <span className={s.track} aria-hidden="true">
                  <span className={s.fill} style={{ width: `${widths[score - 1]}%` }} />
                </span>
                <span className={s.count}>
                  <span className={s.visuallyHidden}>星{score}：</span>
                  {count}
                  <span className={s.visuallyHidden}>件</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className={s.mine}>
        <span id={`${id}-mine`} className={s.mineLabel}>
          {mine ? "あなたの評価（押すと付け直せます）" : "評価する"}
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-mine`} className={s.picker} onMouseLeave={() => setHover(null)}>
          {SCORES.map((score) => (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={mine === score}
              aria-label={`星${score}（${LABELS[score]}）`}
              title={`星${score}（${LABELS[score]}）`}
              className={s.pick}
              data-on={score <= shown ? "" : undefined}
              disabled={!summary}
              onMouseEnter={() => setHover(score)}
              onFocus={() => setHover(score)}
              onBlur={() => setHover(null)}
              onClick={() => void rate(score)}
            >
              <Star size={26} aria-hidden="true" />
            </button>
          ))}
        </div>
        <span className={s.hint} aria-hidden="true">
          {shown ? LABELS[shown] : ""}
        </span>
      </div>
      <p className={s.message} role="status">
        {message}
      </p>
    </section>
  );
}

/** 平均を星5つで出す（端数は星の一部を塗る） */
function Stars({ value }: { value: number }) {
  return (
    <span className={s.stars} aria-hidden="true">
      {SCORES.map((score) => {
        const fill = Math.max(0, Math.min(1, value - (score - 1)));
        return (
          <span key={score} className={s.starBox}>
            <Star size={16} className={s.starEmpty} />
            <span className={s.starFill} style={{ width: `${fill * 100}%` }}>
              <Star size={16} />
            </span>
          </span>
        );
      })}
    </span>
  );
}
