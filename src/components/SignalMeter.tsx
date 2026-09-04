import { Radio, Radar, ShieldCheck, Activity, AlertCircle } from 'lucide-react';

/**
 * Stitch Radar & Link Margin Meter.
 *
 * Combines a high-tech circular radar scope with the correlator's processing gain meter.
 */
export function SignalMeter({ snrDb, phase }: { snrDb: number; phase: string }) {
  const usable = Number.isFinite(snrDb) && snrDb > -50;
  const pct = usable ? Math.max(0, Math.min(1, (snrDb - 4) / 34)) : 0;

  const quality =
    !usable
      ? { label: 'NO SIGNAL', tone: 'text-white/40', badgeBg: 'bg-white/5 border-white/10' }
      : snrDb >= 26
      ? { label: 'EXCELLENT', tone: 'text-emerald-300', badgeBg: 'bg-emerald-500/15 border-emerald-500/30' }
      : snrDb >= 18
      ? { label: 'STRONG', tone: 'text-emerald-300', badgeBg: 'bg-emerald-500/15 border-emerald-500/30' }
      : snrDb >= 12
      ? { label: 'USABLE', tone: 'text-amber-300', badgeBg: 'bg-amber-500/15 border-amber-500/30' }
      : { label: 'MARGINAL', tone: 'text-rose-300', badgeBg: 'bg-rose-500/15 border-rose-500/30' };

  const getPhaseDisplay = (p: string) => {
    switch (p) {
      case 'searching':
        return { label: 'Searching for Preamble Chirp', icon: <Radar className="h-3.5 w-3.5 animate-radar text-cyan-400" /> };
      case 'preamble':
        return { label: 'Preamble Lock Detected', icon: <Radio className="h-3.5 w-3.5 text-amber-400 animate-pulse" /> };
      case 'header':
        return { label: 'Demodulating Frame Header', icon: <Activity className="h-3.5 w-3.5 text-cyan-400 animate-pulse" /> };
      case 'payload':
        return { label: 'Assembling Payload Codeword', icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> };
      case 'stopped':
        return { label: 'Receiver Idle / Microphone Off', icon: <AlertCircle className="h-3.5 w-3.5 text-white/40" /> };
      default:
        return { label: p, icon: <Radio className="h-3.5 w-3.5 text-white/50" /> };
    }
  };

  const phaseInfo = getPhaseDisplay(phase);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#070e1d]/80 p-4 relative overflow-hidden">
      {/* Background Glow */}
      <div
        className="pointer-events-none absolute -left-10 -bottom-10 h-32 w-32 rounded-full opacity-15 blur-2xl"
        style={{ background: 'var(--accent)' }}
        aria-hidden
      />

      <div className="flex flex-col sm:flex-row items-center gap-5">
        {/* Circular Radar Scope HUD (Stitch Signature) */}
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/60 shadow-inner">
          {/* Concentric Range Rings */}
          <div className="absolute inset-2 rounded-full border border-white/10" />
          <div className="absolute inset-5 rounded-full border border-white/5" />
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />

          {/* Rotating Radar Sweep */}
          {phase !== 'stopped' && (
            <div className="absolute inset-0 rounded-full radar-sweep opacity-75" />
          )}

          {/* Active Blips */}
          {usable && (
            <>
              <div
                className="absolute top-4 right-5 h-2 w-2 rounded-full bg-cyan-400 animate-ping"
                style={{ boxShadow: '0 0 8px #06b6d4' }}
              />
              <div
                className="absolute top-4 right-5 h-2 w-2 rounded-full bg-cyan-300"
              />
            </>
          )}

          {/* Center Target Telemetry Badge */}
          <div className="relative z-10 flex flex-col items-center justify-center rounded-full bg-[#080f20]/90 px-3 py-1.5 border border-white/25 shadow-lg backdrop-blur-md">
            <span className="text-[0.55rem] font-bold uppercase tracking-wider text-white/50">SNR</span>
            <span className="num text-xs font-extrabold text-white">
              {usable ? `+${snrDb.toFixed(0)} dB` : '—'}
            </span>
          </div>
        </div>

        {/* Linear Calibrated Margin Bar & State */}
        <div className="flex-1 w-full min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/50">
              Correlator Processing Gain
            </span>
            <span
              className={`num rounded-full border px-2.5 py-0.5 text-xs font-bold ${quality.badgeBg} ${quality.tone}`}
            >
              {usable ? `${snrDb.toFixed(1)} dB · ${quality.label}` : quality.label}
            </span>
          </div>

          {/* Calibrated Signal Margin Bar */}
          <div className="relative h-2.5 overflow-hidden rounded-full bg-black/60 border border-white/10">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${pct * 100}%`,
                background:
                  'linear-gradient(90deg, rgba(var(--accent-rgb), 0.3) 0%, var(--accent) 100%)',
                boxShadow: pct > 0.2 ? '0 0 12px var(--accent-glow)' : 'none',
              }}
            />
            {/* Decode threshold line (+12 dB) */}
            <div
              className="absolute inset-y-0 w-0.5 bg-white z-10 shadow-[0_0_6px_white]"
              style={{ left: `${((12 - 4) / 34) * 100}%` }}
              title="Minimum Decode Threshold: +12 dB"
            />
          </div>

          <div className="mt-1.5 flex justify-between text-[0.62rem] text-white/40 font-medium">
            <span>Weak (0 dB)</span>
            <span className="text-white/75 font-bold">▲ +12 dB Decode Threshold</span>
            <span>Strong (+38 dB)</span>
          </div>

          {/* Receiver Phase Readout */}
          <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-xs">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-white/40">Receiver State</span>
            <div className="flex items-center gap-1.5 font-bold text-white">
              {phaseInfo.icon}
              <span className="num text-xs">{phaseInfo.label}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
