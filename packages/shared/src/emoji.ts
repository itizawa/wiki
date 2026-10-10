import { z } from "zod";

/** 絵文字1つの長さの上限（UTF-16 の単位）。家族や旗などのつながった絵文字でも、これより短い。 */
const PAGE_ICON_MAX = 64;

/** 文字の形でも出る記号を、絵文字の形にする印（異体字セレクタ16） */
const EMOJI_STYLE = "\uFE0F";

/** v フラグの無い古いブラウザ用。絵文字に使う文字だけでできていて、絵や旗の文字を含むか（API が正しい検査をやり直す） */
const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}#*0-9\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]+$/u;
const PICTURE_CHAR = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u;

let rgiEmoji: RegExp | null | undefined;

/**
 * 文字列の全体が、Unicode が「広く使える」としている絵文字1つ（RGI_Emoji）か。
 * 肌の色の付いたもの・つないで1つにしたもの（家族など）・旗・キーキャップも1つと数える。
 * 文字・数字・記号だけのものや、絵文字が2つ以上のものは通さない。
 */
function isSingleEmoji(text: string): boolean {
  if (rgiEmoji === undefined) {
    try {
      // v フラグの正規表現は、対応していない環境では読み込んだ時点で文法エラーになるので、文字列から作る
      rgiEmoji = new RegExp("^\\p{RGI_Emoji}$", "v");
    } catch {
      rgiEmoji = null;
    }
  }
  return rgiEmoji ? rgiEmoji.test(text) : EMOJI_CHARS.test(text) && PICTURE_CHAR.test(text);
}

/**
 * ページのアイコンにできる形に整える。絵文字1つでなければ null。
 * 前後の空白は落とす。「❤」のように文字の形でも出る記号は、絵文字の形（「❤️」）にそろえる。
 */
export function normalizePageIcon(input: string): string | null {
  const text = input.trim();
  if (text === "" || text.length > PAGE_ICON_MAX) return null;
  if (isSingleEmoji(text)) return text;
  const styled = text + EMOJI_STYLE;
  return isSingleEmoji(styled) ? styled : null;
}

/** ページのアイコン（絵文字1つ）。公開サイトの HTML にそのまま出るので、絵文字以外は受け付けない。 */
export const pageIconSchema = z
  .string()
  .max(PAGE_ICON_MAX * 2)
  .transform((value, ctx) => {
    const icon = normalizePageIcon(value);
    if (icon !== null) return icon;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "icon must be a single emoji" });
    return z.NEVER;
  });

/** ページのアイコンを付ける・変える・外す（null）。 */
export const setPageIconInput = z.object({ icon: pageIconSchema.nullable() });
export type SetPageIconInput = z.infer<typeof setPageIconInput>;
