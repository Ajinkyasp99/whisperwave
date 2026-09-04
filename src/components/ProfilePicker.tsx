import { PROFILES, PROFILE_ORDER, deriveParams, type ProfileId } from '../dsp/profiles';
import { useStore } from '../store/useStore';

function EarOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5">
      <path d="M6 8a6 6 0 0 1 10-4.5" strokeLinecap="round" />
      <path d="M8.5 20c1.8-1.4 2-3 2.6-4.4.4-1 1-1.6 2.1-2.3" strokeLinecap="round" />
      <path d="M3 3l18 18" strokeLinecap="round" />
    </svg>
  );
}

export function ProfilePicker() {
  const { profileId, setProfile, sampleRate, listening, transmitting } = useStore();

  return (
    <div
      role="radiogroup"
      aria-label="Transmission profile"
      className="grid grid-cols-2 gap-2 lg:grid-cols-4"
    >
      {PROFILE_ORDER.map((id) => {
        const p = PROFILES[id];
        const params = deriveParams(p, sampleRate);
        const active = id === profileId;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            data-accent={p.accent}
            disabled={transmitting}
            onClick={() => setProfile(id as ProfileId)}
            className={`no-tap relative overflow-hidden rounded-2xl border p-2.5 text-left transition disabled:opacity-50 sm:p-3 ${
              active
                ? 'border-white/20 bg-white/[0.07] shadow-lg shadow-black/30'
                : 'border-white/8 bg-white/[0.025] hover:bg-white/[0.05]'
            }`}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{ background: 'var(--accent)' }}
              />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-white/70'}`}>{p.name}</span>
              {p.inaudible ? (
                <span className="accent-text" title="Inaudible to human hearing">
                  <EarOff />
                </span>
              ) : null}
            </div>
            <div className="num mt-1 text-[0.68rem] text-white/45">
              {(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz
              <span className="text-white/25"> · </span>
              {params.bitsPerSecond.toFixed(0)} b/s
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="num text-base leading-none sm:text-lg" style={{ color: active ? 'var(--accent)' : undefined }}>
                {p.rangeLabel}
              </span>
              <span className="text-[0.62rem] text-white/35">{listening && active ? 'tuned' : 'range'}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
