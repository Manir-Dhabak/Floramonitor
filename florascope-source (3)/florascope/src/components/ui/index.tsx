"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#0f1a15" stroke="#24382e" />
        <circle cx="32" cy="32" r="19" fill="none" stroke="#3ddc97" strokeWidth="3" strokeDasharray="4 5" />
        <path d="M32 46c0-10 0-17 9-24-12 1-17 8-17 15 0 4 3 8 8 9z" fill="#3ddc97" />
        <path d="M32 46c0-6-2-11-8-15" stroke="#0f1a15" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </svg>
      {withText && (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-ink">FloraScope</span>
          <span className="block text-[10px] uppercase tracking-[0.16em] text-muted">by Flora Carbon AI</span>
        </span>
      )}
    </span>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export function Button({ variant = "outline", size = "md", icon, className, children, ...rest }: BtnProps) {
  const v = {
    primary: "bg-leaf text-[#04110b] hover:bg-[#5ef0ae] font-semibold shadow-[0_0_0_1px_rgba(61,220,151,.4)]",
    ghost: "text-ink2 hover:bg-panel3 hover:text-ink",
    outline: "border border-line2 text-ink2 hover:border-leaf/60 hover:text-ink bg-panel2/60",
    danger: "border border-bad/40 text-bad hover:bg-bad/10",
    subtle: "bg-panel3 text-ink2 hover:text-ink hover:bg-line",
  }[variant];
  const s = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2.5" }[size];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
        v,
        s,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "good" | "warn" | "bad" | "info" | "manual"; children: ReactNode; className?: string }) {
  const t = {
    neutral: "bg-panel3 text-ink2 border-line2",
    good: "bg-leaf/10 text-leaf border-leaf/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    bad: "bg-bad/10 text-bad border-bad/30",
    info: "bg-sky/10 text-sky border-sky/30",
    manual: "bg-manual/10 text-manual border-manual/30",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", t, className)}>{children}</span>;
}

export function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  right,
  hint,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  hint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-panel2/50">
        <span className="text-leaf">{icon}</span>
        <span className="flex-1 text-[13px] font-semibold tracking-tight text-ink">{title}</span>
        {right}
        <ChevronDown size={15} className={cx("text-muted transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {hint && <p className="text-[11.5px] leading-relaxed text-muted">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 flex items-center gap-1 text-[11.5px] font-medium text-ink2" title={hint}>
      {children}
      {hint && <span className="cursor-help text-faint">ⓘ</span>}
    </span>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  unit,
  hint,
  disabled,
  digits,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  digits?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? Number(value.toFixed(digits ?? 4)).toString();
  return (
    <label htmlFor={id} className="block">
      <Label hint={hint}>{label}</Label>
      <div className={cx("flex h-8 items-center rounded-md border border-line2 bg-panel focus-within:border-leaf/70", disabled && "opacity-50")}>
        <input
          id={id}
          type="number"
          disabled={disabled}
          step={step}
          min={min}
          max={max}
          value={shown}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : v);
          }}
          onBlur={() => setDraft(null)}
          className="tabular h-full w-full min-w-0 bg-transparent px-2.5 text-[13px] text-ink outline-none"
        />
        {unit && <span className="pr-2.5 text-[11px] text-muted">{unit}</span>}
      </div>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-line2 bg-panel px-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-leaf/70"
      />
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}) {
  return (
    <label className="block">
      {label && <Label hint={hint}>{label}</Label>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-8 w-full appearance-none rounded-md border border-line2 bg-panel pl-2.5 pr-7 text-[13px] text-ink outline-none focus:border-leaf/70"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-panel">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-0.5 text-left" title={hint}>
      <span className="text-[12px] text-ink2">{label}</span>
      <span className={cx("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", checked ? "bg-leaf" : "bg-line2")}>
        <span className={cx("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all", checked ? "left-[16px]" : "left-[2px]")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line2 bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]",
            value === o.value ? "bg-panel3 text-ink shadow-[inset_0_0_0_1px_#2a3a32]" : "text-muted hover:text-ink2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className, title, right, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode; pad?: boolean }) {
  return (
    <div className={cx("rounded-xl border border-line bg-panel", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="text-[13px] font-semibold tracking-tight text-ink">{title}</div>
          {right}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
  icon?: ReactNode;
}) {
  const t = { neutral: "text-ink", good: "text-leaf", warn: "text-warn", bad: "text-bad" }[tone];
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cx("tabular mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight", t)}>
        {value}
        {unit && <span className="ml-1 text-[12px] font-medium text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Progress({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className="h-full rounded-full bg-leaf transition-all duration-300" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-faint">{icon}</div>
      <div className="text-sm font-semibold text-ink2">{title}</div>
      {children && <div className="max-w-md text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString("en-IN"),
  n: (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"),
  pct: (v: number, d = 1) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "—"),
  t: (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)),
};
