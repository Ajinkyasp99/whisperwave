import { useDirectionFinder } from '../hooks/useDirectionFinder';
import { Radio, Radar, ShieldCheck, Activity, AlertCircle, Compass, Navigation } from 'lucide-react';

function getCardinalDirection(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'N';
  if (norm >= 22.5 && norm < 67.5) return 'NE';
  if (norm >= 67.5 && norm < 112.5) return 'E';
  if (norm >= 112.5 && norm < 157.5) return 'SE';
  if (norm >= 157.5 && norm < 202.5) return 'S';
  if (norm >= 202.5 && norm < 247.5) return 'SW';
  if (norm >= 247.5 && norm < 292.5) return 'W';
  return 'NW';
}

/**
 * Stitch Spatial Radar & Link Margin Meter with Acoustic Direction Finding (DOA).
 *
 * Shows the real-time Direction of Arrival (DOA) of incoming acoustic/voice signals
 * combined with phone compass orientation and correlator gain.
 */
export function SignalMeter({ snrDb, phase }: { snrDb: number; phase: string }) {
  const {
    bearing,
    confidence,
    compassHeading,
    compassSupported,
    compassActive,
    isStereo,
    listening,
    requestCompassPermission,
  } = useDirectionFinder();

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
        return { label: 'Scanning for Preamble Chirp', icon: <Radar className="h-3.5 w-3.5 animate-radar text-cyan-400" /> };
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
  const cardinal = getCardinalDirection(bearing);
  const hasDirectionLock = listening && (usable || confidence > 0.25);

  // Position of DOA blip on the radar circle (radius = 38px)
  const blipRadius = 38;
  const angleRad = ((bearing - 90) * Math.PI) / 180;
  const blipX = Math.cos(angleRad) * blipRadius;
  const blipY = Math.sin(angleRad) * blipRadius;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#070e1d]/90 p-3.5 sm:p-4 relative overflow-hidden">
      {/* Background Glow */}
      <div
        className="pointer-events-none absolute -left-10 -bottom-10 h-32 w-32 rounded-full opacity-15 blur-2xl"
        style={{ background: 'var(--accent)' }}
        aria-hidden
      />

      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
        {/* Circular Radar Scope HUD with Spatial Direction of Arrival */}
        <div className="relative flex h-28 w-28 sm:h-32 sm:w-32 shrink-0 items-center justify-center rounded-full border border-cyan-500/30 bg-black/75 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
          {/* Compass Axis Cardinal Markers */}
          <span className="absolute top-1 text-[0.55rem] font-black text-cyan-300">N</span>
          <span className="absolute right-1 text-[0.55rem] font-bold text-white/40">E</span>
          <span className="absolute bottom-1 text-[0.55rem] font-bold text-white/40">S</span>
          <span className="absolute left-1 text-[0.55rem] font-bold text-white/40">W</span>

          {/* Concentric Range Rings */}
          <div className="absolute inset-2.5 rounded-full border border-cyan-500/20" />
          <div className="absolute inset-5 rounded-full border border-cyan-500/10" />
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cyan-500/20" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-cyan-500/20" />

          {/* 360 Radar Sweep Beam */}
          {phase !== 'stopped' && (
            <div className="absolute inset-0 rounded-full radar-sweep opacity-70" />
          )}

          {/* Direction of Arrival (DOA) Vector Beam & Sector */}
          {hasDirectionLock && (
            <>
              {/* Directional Sector Cone */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none transition-transform duration-300"
                style={{
                  transform: `rotate(${bearing}deg)`,
                  background:
                    'conic-gradient(from -20deg, transparent 0deg, rgba(6, 182, 212, 0.4) 20deg, transparent 40deg)',
                }}
              />

              {/* Direction Indicator Vector Line */}
              <div
                className="absolute inset-x-0 top-1/2 h-0.5 pointer-events-none origin-center transition-transform duration-300"
                style={{
                  transform: `rotate(${bearing - 90}deg)`,
                  background: 'linear-gradient(90deg, transparent 50%, var(--accent) 100%)',
                  boxShadow: '0 0 10px var(--accent)',
                }}
              />

              {/* Direction Target Lock Blip */}
              <div
                className="absolute h-3 w-3 rounded-full bg-cyan-400 pointer-events-none shadow-[0_0_12px_#06b6d4] transition-all duration-300 flex items-center justify-center"
                style={{
                  transform: `translate(${blipX}px, ${blipY}px)`,
                }}
              >
                <div className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
              </div>
            </>
          )}

          {/* Center Target Telemetry Badge */}
          <div className="relative z-10 flex flex-col items-center justify-center rounded-full bg-[#080f20]/95 px-2.5 py-1 border border-white/25 shadow-lg backdrop-blur-md">
            <span className="text-[0.52rem] font-bold uppercase tracking-wider text-white/50">
              {hasDirectionLock ? cardinal : 'SNR'}
            </span>
            <span className="num text-[0.7rem] sm:text-xs font-black text-white">
              {usable ? `+${snrDb.toFixed(0)}dB` : hasDirectionLock ? `${bearing}°` : '—'}
            </span>
          </div>
        </div>

        {/* Direction Readout & Processing Gain Bar */}
        <div className="flex-1 w-full min-w-0">
          {/* Direction of Arrival Telemetry Header */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Navigation
                className={`h-3.5 w-3.5 transition-transform duration-300 shrink-0 ${
                  hasDirectionLock ? 'text-cyan-400' : 'text-white/40'
                }`}
                style={{ transform: `rotate(${bearing}deg)` }}
              />
              <span className="text-[0.62rem] sm:text-[0.68rem] font-black uppercase tracking-[0.16em] text-white/80 truncate">
                Sound Direction: <span className="accent-text num">{bearing.toString().padStart(3, '0')}° {cardinal}</span>
              </span>
            </div>

            <span
              className={`num shrink-0 rounded-full border px-2 sm:px-2.5 py-0.5 text-[0.62rem] sm:text-xs font-bold ${quality.badgeBg} ${quality.tone}`}
            >
              {usable ? `${snrDb.toFixed(1)} dB · ${quality.label}` : quality.label}
            </span>
          </div>

          {/* Calibrated Signal Margin Bar */}
          <div className="relative h-2 sm:h-2.5 overflow-hidden rounded-full bg-black/60 border border-white/10">
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

          <div className="mt-1.5 flex justify-between text-[0.58rem] sm:text-[0.62rem] text-white/40 font-medium">
            <span>0 dB</span>
            <span className="text-white/75 font-bold">▲ +12 dB Decode Min</span>
            <span>+38 dB</span>
          </div>

          {/* Spatial Tracker Status & Receiver State */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-white/[0.06] pt-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-white min-w-0">
              {phaseInfo.icon}
              <span className="num text-[0.68rem] sm:text-xs truncate">{phaseInfo.label}</span>
            </div>

            {/* Compass / Stereo Mic DOA Pill */}
            <div className="flex items-center gap-1.5">
              {compassSupported && !compassActive ? (
                <button
                  type="button"
                  onClick={requestCompassPermission}
                  className="flex items-center gap-1 rounded bg-cyan-500/10 px-2 py-0.5 text-[0.58rem] font-bold text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all active:scale-95"
                >
                  <Compass className="h-2.5 w-2.5" />
                  <span>Enable Compass</span>
                </button>
              ) : compassActive ? (
                <span className="num flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[0.58rem] font-bold text-emerald-300 border border-emerald-500/30">
                  <Compass className="h-2.5 w-2.5 animate-spin" style={{ animationDuration: '8s' }} />
                  <span>Compass Head: {compassHeading}°</span>
                </span>
              ) : (
                <span className="num rounded bg-white/[0.04] px-1.5 py-0.5 text-[0.58rem] font-bold text-white/50 border border-white/10">
                  {isStereo ? 'Stereo Phase DOA' : 'Acoustic Phase DOA'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
