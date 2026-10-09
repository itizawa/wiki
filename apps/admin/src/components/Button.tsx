import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import styles from "./Button.module.css";

type Variant = "primary" | "danger";

// <a> などボタン以外の要素をボタンの見た目にするときに使う
export const buttonClass = (variant?: Variant) => cx(styles.button, variant && styles[variant]);

export function Button({ variant, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={cx(buttonClass(variant), className)} />;
}
