/** 構造の履歴で、メッセージの無いコミットに出す言葉。 */
export const NO_MESSAGE_LABEL = "（説明なし）";

export function commitMessageLabel(message: string | null | undefined): string {
  return message?.trim() ? message : NO_MESSAGE_LABEL;
}
