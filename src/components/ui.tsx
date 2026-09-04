import type { ReactNode } from 'react';

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function PanelTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/45">{children}</h2>
      {hint ? <span className="num text-[0.7rem] text-white/35">{hint}</span> : null}
    </header>
  );
}

export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[0.62rem] uppercase tracking-[0.14em] text-white/35">{label}</div>
      <div className="num mt-0.5 truncate text-sm text-white/85">
        {value}
        {unit ? <span className="ml-0.5 text-white/40">{unit}</span> : null}
      </div>
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'accent' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  className?: string;
  title?: string;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'ghost',
  size = 'md',
  className = '',
  title,
}: ButtonProps) {
  const base =
    'no-tap inline-flex items-center justify-center gap-2 rounded-xl font-medium transition ' +
    'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2';
  const sizes = size === 'lg' ? 'min-h-[3.25rem] px-5 text-base' : 'min-h-[2.75rem] px-4 text-sm';
  const variants: Record<string, string> = {
    accent: 'text-ink-950 shadow-lg shadow-black/40 hover:brightness-110 active:brightness-95',
    ghost: 'border border-white/12 bg-white/5 text-white/85 hover:bg-white/10 active:bg-white/15',
    danger: 'border border-rose-400/30 bg-rose-500/12 text-rose-200 hover:bg-rose-500/20',
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={variant === 'accent' ? { background: 'var(--accent)', outlineColor: 'var(--accent)' } : undefined}
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-white/55">{label}</span>
        <span className="num text-xs text-white/75">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' }) {
  const tones: Record<string, string> = {
    neutral: 'border-white/12 bg-white/5 text-white/60',
    accent: 'border-transparent text-ink-950',
    warn: 'border-amber-300/30 bg-amber-400/10 text-amber-200',
  };
  return (
    <span
      style={tone === 'accent' ? { background: 'var(--accent)' } : undefined}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
