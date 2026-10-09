import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx";
import styles from "./Badge.module.css";

export function Badge({
  tone,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "public" | "unlisted" | "private" }) {
  return <span {...props} className={cx(styles.badge, tone && styles[tone], className)} />;
}
