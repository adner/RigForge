import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const base =
  "inline-flex items-center gap-1.5 font-sans tracking-[0.01em] font-semibold rounded-chamfer transition-colors duration-150 select-none disabled:opacity-40";
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-spec",
  md: "h-9 px-3.5 text-label",
};
const variants: Record<Variant, string> = {
  primary: "bg-glacier text-white hover:bg-[#126b91] active:bg-[#0e5e80]",
  outline: "border border-seam-strong text-bone hover:border-glacier hover:text-glacier",
  ghost: "text-ash hover:text-bone hover:bg-plate",
  danger: "text-fault hover:bg-fault-dim",
};

export function Button({ variant = "outline", size = "md", icon, className = "", children, ...rest }: Props) {
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
