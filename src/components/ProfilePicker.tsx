import { PROFILES, PROFILE_ORDER, deriveParams, type ProfileId } from '../dsp/profiles';
import { useStore } from '../store/useStore';
import { VolumeX, ShieldCheck, Sliders, Radio } from 'lucide-react';

export function ProfilePicker() {
  const { profileId, setProfile, sampleRate, listening, transmitting } = useStore();

  const getProfileIcon = (id: ProfileId) => {
    switch (id) {
      case 'ghost':
        return <VolumeX className="h-4 w-4 text-violet-400" />;
      case 'stealth':
        return <ShieldCheck className="h-4 w-4 text-cyan-400" />;
      case 'balanced':
        return <Sliders className="h-4 w-4 text-emerald-400" />;
      case 'longrange':
        return <Radio className="h-4 w-4 text-amber-400" />;
    }
  };

  const getProfileBadge = (id: ProfileId) => {
    switch (id) {
      case 'ghost':
        return { label: 'SILENT', bg: 'bg-violet-500/20 text-violet-300 border-violet-500/40' };
      case 'stealth':
        return { label: 'ULTRASONIC', bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' };
      case 'balanced':
        return { label: 'BALANCED', bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
      case 'longrange':
        return { label: 'LONG RANGE', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full accent-bg animate-pulse" />
          <span className="text-[0.7rem] font-extrabold uppercase tracking-[0.2em] text-white/60">
            Acoustic Band Profile
          </span>
        </div>
        <span className="text-[0.65rem] font-medium text-white/40">
          {transmitting ? 'Locked during burst' : 'Select carrier frequency'}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Transmission profile"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {PROFILE_ORDER.map((id) => {
          const p = PROFILES[id];
          const params = deriveParams(p, sampleRate);
          const active = id === profileId;
          const badge = getProfileBadge(id as ProfileId);

          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              data-accent={p.accent}
              disabled={transmitting}
              onClick={() => setProfile(id as ProfileId)}
              className={`no-tap panel-interactive corner-mark corner-mark-tl corner-mark-br relative overflow-hidden rounded-2xl border p-3.5 sm:p-4 text-left transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? 'border-white/30 bg-[#0f172a]/90 shadow-2xl ring-1 ring-white/30 neon-glow'
                  : 'border-white/10 bg-[#080e1c]/60 hover:bg-[#0c1529]/80 hover:border-white/20'
              }`}
            >
              {/* Dynamic top accent illumination */}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px] transition-all"
                  style={{ background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }}
                />
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/50 border border-white/10 shadow-inner">
                    {getProfileIcon(id as ProfileId)}
                  </div>
                  <div>
                    <span className={`text-sm sm:text-base font-extrabold ${active ? 'text-white' : 'text-white/85'}`}>
                      {p.name}
                    </span>
                  </div>
                </div>

                <span
                  className={`rounded-md border px-2 py-0.5 text-[0.6rem] font-extrabold tracking-wider ${badge.bg}`}
                >
                  {badge.label}
                </span>
              </div>

              {/* Frequencies and Speed Readout */}
              <div className="num mt-3 flex items-center justify-between text-[0.68rem] text-white/55 border-t border-white/[0.08] pt-2.5">
                <span className="font-semibold">
                  {(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz
                </span>
                <span className="font-extrabold text-cyan-300">
                  {params.bitsPerSecond.toFixed(0)} b/s
                </span>
              </div>

              {/* Range & Tune status */}
              <div className="mt-2.5 flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="num text-lg font-black leading-none"
                    style={{ color: active ? 'var(--accent)' : '#f8fafc' }}
                  >
                    {p.rangeLabel}
                  </span>
                  <span className="text-[0.62rem] text-white/40 uppercase tracking-widest font-bold">RANGE</span>
                </div>

                {listening && active ? (
                  <span className="accent-text num text-[0.62rem] font-extrabold uppercase tracking-widest flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full accent-bg animate-ping" />
                    TUNED
                  </span>
                ) : (
                  <span className="text-[0.62rem] text-white/30 num uppercase">SF{params.sf}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
