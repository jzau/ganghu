import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; children: ReactNode }) {
  const styles = {
    primary: "border-0 bg-[#1a1a1a] text-[#ececec] shadow-nm-out hover:brightness-110 active:shadow-nm-in",
    secondary: "border-0 bg-[#ececec] text-[#2a2a2a] shadow-nm-out hover:brightness-[1.02] active:shadow-nm-in",
    ghost: "border-0 bg-[#ececec] text-[#2a2a2a] shadow-nm-out hover:brightness-[1.02] active:shadow-nm-in"
  };
  return (
    <button
      className={`focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
