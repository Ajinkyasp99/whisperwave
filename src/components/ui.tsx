import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

export function Panel({
  children,
  className = '',
  highlight = false,
  cornerMarks = true,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
  cornerMarks?: boolean;
}) {
  return (
    <section
      className={`panel relative p-3.5 sm:p-5 transition-all duration-300 ${
        cornerMarks ? 'corner-mark corner-mark-tl corner-mark-br' : ''
      } ${
        highlight ? 'border-white/25 shadow-2xl neon-glow' : ''
      } ${className}`}
    >
      {highlight && (
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full opacity-20 blur-3xl"
          style={{ background: 'var(--accent)' }}
          aria-hidden
        />
      )}
      {children}
    </section>
  );
}

export function PanelTitle({
  children,
  hint,
  icon,
}: {
  children: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="mb-3.5 sm:mb-4 flex items-center justify-between gap-2.5 border-b border-white/[0.08] pb-2.5 sm:pb-3">
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04] border border-white/10 accent-text">
            {icon}
          </div>
        )}
        <h2 className="text-[0.68rem] sm:text-[0.72rem] font-extrabold uppercase tracking-[0.18em] text-white/80 truncate">
          {children}
        </h2>
      </div>
      {hint ? (
        <span className="num shrink-0 rounded-md bg-white/[0.04] px-2 sm:px-2.5 py-0.5 text-[0.62rem] sm:text-[0.68rem] font-bold text-white/60 border border-white/[0.08] tracking-wider">
          {hint}
        </span>
      ) : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] border border-white/[0.06] p-2 sm:p-2.5 transition-all duration-200 hover:bg-white/[0.06] hover:border-white/15">
      <div className="flex items-center gap-1 truncate text-[0.58rem] sm:text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/45">
        {icon && <span className="opacity-75 accent-text shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="num mt-0.5 sm:mt-1 flex items-baseline gap-1 truncate text-[0.82rem] sm:text-base font-bold text-white">
        <span className="truncate">{value}</span>
        {unit ? <span className="text-[0.62rem] sm:text-[0.68rem] font-normal text-white/45 shrink-0">{unit}</span> : null}
      </div>
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'accent' | 'ghost' | 'danger' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
  type?: 'button' | 'submit' | 'reset';
  icon?: ReactNode;
  scanline?: boolean;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'ghost',
  size = 'md',
  className = '',
  title,
  type = 'button',
  icon,
  scanline = false,
}: ButtonProps) {
  const base =
    'no-tap inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-all duration-200 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 select-none';

  const sizes =
    size === 'lg'
      ? 'min-h-[3.25rem] px-5 sm:px-6 text-sm sm:text-base tracking-wide'
      : size === 'sm'
      ? 'min-h-[2.25rem] px-2.5 sm:px-3 text-xs'
      : 'min-h-[2.75rem] px-3.5 sm:px-4 text-xs sm:text-sm';

  const variants: Record<string, string> = {
    accent:
      'text-slate-950 font-extrabold shadow-lg shadow-black/50 hover:brightness-110 active:brightness-95 hover:shadow-[0_0_25px_0_var(--accent-glow)] border border-white/20',
    ghost:
      'border border-white/12 bg-white/[0.04] text-white/85 hover:bg-white/[0.09] hover:border-white/25 active:bg-white/[0.14]',
    secondary:
      'border border-white/20 bg-white/[0.08] text-white hover:bg-white/[0.15] active:bg-white/[0.2]',
    danger:
      'border border-rose-500/40 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30 hover:border-rose-500/60 shadow-[0_0_15px_rgba(244,63,94,0.2)]',
  };

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={
        variant === 'accent'
          ? {
              background: 'var(--accent)',
              outlineColor: 'var(--accent)',
            }
          : undefined
      }
      className={`${base} ${sizes} ${variants[variant]} ${scanline ? 'scanline' : ''} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
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
  icon,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  icon?: ReactNode;
}) {
  return (
    <label className="block rounded-xl bg-white/[0.025] border border-white/[0.05] p-2.5 sm:p-3 transition hover:border-white/[0.1] hover:bg-white/[0.04]">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {icon && <span className="accent-text opacity-90">{icon}</span>}
          <span className="text-xs font-semibold text-white/75">{label}</span>
        </div>
        <span className="num rounded-md bg-white/[0.08] px-2 py-0.5 text-xs font-extrabold text-white border border-white/10">
          {format(value)}
        </span>
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

export function Badge({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'success' | 'danger';
  icon?: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-white/12 bg-white/[0.04] text-white/75',
    accent: 'border-transparent text-slate-950 font-extrabold',
    warn: 'border-amber-400/40 bg-amber-400/15 text-amber-200',
    success: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
    danger: 'border-rose-400/40 bg-rose-400/15 text-rose-200',
  };

  return (
    <span
      style={tone === 'accent' ? { background: 'var(--accent)' } : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.65rem] sm:text-[0.68rem] font-bold transition tracking-wide ${tones[tone]}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  icon,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="panel relative z-10 max-h-[88vh] w-full max-w-2xl overflow-y-auto border border-white/20 bg-[#070d1a]/95 p-4 sm:p-6 shadow-2xl neon-glow">
        <div className="mb-3.5 sm:mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            {icon && <span className="accent-text flex items-center shrink-0">{icon}</span>}
            <h3 className="text-sm sm:text-lg font-bold tracking-tight text-white truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
