import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import styles from "./LinkButton.module.css";

export function LinkButton({
  danger,
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; active?: boolean }) {
  return <button {...props} className={cx(styles.link, danger && styles.danger, active && styles.active, className)} />;
}
