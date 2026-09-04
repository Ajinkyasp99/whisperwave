/**
 * Link-quality meter.
 *
 * Shows the correlator's processing gain over the noise floor, which is the
 * number that actually predicts whether a frame will decode - not the raw
 * microphone level, which mostly tracks how loud the room is.
 */
export function SignalMeter({ snrDb, phase }: { snrDb: number; phase: string }) {
  const usable = Number.isFinite(snrDb) && snrDb > -50;
  const pct = usable ? Math.max(0, Math.min(1, (snrDb - 4) / 34)) : 0;

  const quality =
    !usable ? { label: 'no signal', tone: 'text-white/35' }
    : snrDb >= 26 ? { label: 'excellent', tone: 'text-emerald-300' }
    : snrDb >= 18 ? { label: 'strong', tone: 'text-emerald-300' }
    : snrDb >= 12 ? { label: 'usable', tone: 'text-amber-300' }
    : { label: 'marginal', tone: 'text-rose-300' };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[0.62rem] uppercase tracking-[0.14em] text-white/35">link margin</span>
        <span className={`num text-xs ${quality.tone}`}>
          {usable ? `${snrDb.toFixed(1)} dB · ${quality.label}` : quality.label}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${pct * 100}%`,
            background: 'linear-gradient(90deg, color-mix(in oklab, var(--accent) 45%, transparent), var(--accent))',
          }}
        />
        {/* The decode threshold, so the bar means something absolute. */}
        <div className="absolute inset-y-0 w-px bg-white/30" style={{ left: `${((12 - 4) / 34) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[0.6rem] text-white/30">
        <span>weak</span>
        <span>decode threshold</span>
        <span>strong</span>
      </div>
      <div className="num mt-2 text-[0.68rem] text-white/45">receiver: {phase}</div>
    </div>
  );
}
