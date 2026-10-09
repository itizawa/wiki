import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cx } from "../lib/cx";
import styles from "./Tabs.module.css";

export function Tabs({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx(styles.tabs, className)} />;
}

export function Tab({ active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...props} className={cx(styles.tab, active && styles.active, className)} />;
}
