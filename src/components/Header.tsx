import { useStore } from '../store/useStore';
import {
  Waves,
  MicOff,
  Cpu,
  Volume2,
  VolumeX,
  HelpCircle,
  Activity,
} from 'lucide-react';

export function Header() {
  const {
    listening,
    sampleRate,
    soundAlerts,
    setSoundAlerts,
    setActiveModal,
    level,
  } = useStore();

  const micDb = listening ? 20 * Math.log10(Math.max(level, 1e-6)) : -99;
  const vuPct = listening ? Math.min(100, Math.max(0, (micDb + 60) * 1.66)) : 0;

  return (
    <header className="safe-t no-print sticky top-0 z-40 -mx-4 mb-4 border-b border-white/10 bg-[#030712]/92 px-3 sm:px-4 py-2.5 backdrop-blur-2xl transition-all shadow-[0_4px_24px_rgba(0,0,0,0.7)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
        {/* Brand Identity & Pulse Ring */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] border border-white/15 shadow-xl transition-transform hover:scale-105">
            <span
              className="ping-ring absolute inset-0 rounded-xl border opacity-80"
              style={{ borderColor: 'var(--accent)' }}
              aria-hidden
            />
            <span
              className="ping-ring ping-ring-2 absolute inset-0 rounded-xl border opacity-50"
              style={{ borderColor: 'var(--accent)' }}
              aria-hidden
            />
            <Waves className="relative h-4 w-4 sm:h-5 sm:w-5 accent-text" />
          </div>

          <div className="leading-tight min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-base sm:text-[1.1rem] font-black tracking-tight text-white font-sans truncate">
                WhisperWave
              </span>
              <span className="shrink-0 inline-flex items-center rounded bg-cyan-500/15 px-1.5 py-0.5 text-[0.58rem] sm:text-[0.62rem] font-black text-cyan-300 border border-cyan-500/30 tracking-wider">
                PRO DSP
              </span>
            </div>
            <div className="text-[0.65rem] font-medium text-white/45 hidden sm:block truncate">
              Acoustic Data Link · Peer-to-Peer
            </div>
          </div>
        </div>

        {/* Action Controls & Telemetry Pills */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Live Mic Status Pill with VU Meter */}
          <div
            className={`flex items-center gap-1.5 rounded-xl border px-2 sm:px-3 py-1 text-xs font-bold transition-all duration-200 ${
              listening
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                : 'border-white/10 bg-white/[0.03] text-white/50'
            }`}
          >
            {listening ? (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <div
                  className="h-2.5 w-7 sm:w-10 overflow-hidden rounded bg-black/50 border border-emerald-500/30"
                  title={`Mic Level: ${micDb.toFixed(0)} dBFS`}
                >
                  <div
                    className="h-full bg-emerald-400 transition-all duration-100"
                    style={{ width: `${vuPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <MicOff className="h-3 w-3 sm:h-3.5 sm:w-3.5 opacity-60 shrink-0" />
            )}
            <span className="text-[0.62rem] sm:text-[0.68rem] tracking-wider uppercase hidden md:inline">
              {listening ? 'ACTIVE' : 'OFF'}
            </span>
          </div>

          {/* Sample Rate Indicator */}
          <button
            type="button"
            onClick={() => setActiveModal('diagnostics')}
            title="Audio Hardware Sample Rate (Click for Diagnostics)"
            className="flex items-center gap-1 rounded-xl border border-white/12 bg-white/[0.04] px-2 sm:px-2.5 py-1 text-[0.65rem] sm:text-[0.68rem] font-extrabold text-cyan-300 hover:bg-white/[0.09] hover:border-cyan-400/40 transition-all active:scale-95"
          >
            <Cpu className="h-3 w-3 sm:h-3.5 sm:w-3.5 accent-text shrink-0" />
            <span className="num">{(sampleRate / 1000).toFixed(0)}k</span>
          </button>

          {/* Sound Alert Toggle */}
          <button
            type="button"
            onClick={() => setSoundAlerts(!soundAlerts)}
            title={soundAlerts ? 'Sound feedback on message decode (Enabled)' : 'Sound feedback muted'}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.09] hover:text-white transition-all active:scale-95"
            aria-label="Toggle sound alerts"
          >
            {soundAlerts ? <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-cyan-400" /> : <VolumeX className="h-3.5 w-3.5 sm:h-4 sm:w-4 opacity-40" />}
          </button>

          {/* Diagnostics Modal Button */}
          <button
            type="button"
            onClick={() => setActiveModal('diagnostics')}
            title="Acoustic & Hardware Diagnostics"
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.09] hover:text-white transition-all active:scale-95"
            aria-label="Open Diagnostics"
          >
            <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>

          {/* How It Works Guide Button */}
          <button
            type="button"
            onClick={() => setActiveModal('guide')}
            title="How WhisperWave Works"
            className="flex h-8 sm:h-9 items-center gap-1 rounded-xl border border-white/12 bg-white/[0.04] px-2 sm:px-3 py-1 text-xs font-bold text-white hover:bg-white/[0.09] hover:border-white/25 transition-all active:scale-95"
            aria-label="Open Guide"
          >
            <HelpCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 accent-text shrink-0" />
            <span className="hidden sm:inline">Guide</span>
          </button>
        </div>
      </div>
    </header>
  );
}
