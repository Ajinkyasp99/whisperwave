import { useMemo } from 'react';
import { PROFILES, deriveParams } from '../dsp/profiles';
import { PILOT_PERIOD } from '../dsp/pilots';
import { useStore } from '../store/useStore';
import { Panel, PanelTitle, Stat } from './ui';

/** What the link is actually doing right now, for anyone who wants the numbers. */
export function LinkFacts() {
  const { profileId, sampleRate } = useStore();
  const params = useMemo(() => deriveParams(PROFILES[profileId], sampleRate), [profileId, sampleRate]);
  const processingGainDb = 10 * Math.log10(params.N);

  return (
    <Panel>
      <PanelTitle hint="chirp spread spectrum">Link parameters</PanelTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="band" value={`${(params.bandLow / 1000).toFixed(2)}–${(params.bandHigh / 1000).toFixed(2)}`} unit="kHz" />
        <Stat label="bandwidth" value={params.bw.toFixed(0)} unit="Hz" />
        <Stat label="spreading" value={`SF${params.sf}`} />
        <Stat label="chips/symbol" value={params.N} />
        <Stat label="symbol" value={(params.symbolSeconds * 1000).toFixed(1)} unit="ms" />
        <Stat label="throughput" value={params.bitsPerSecond.toFixed(0)} unit="bit/s" />
        <Stat label="processing gain" value={`+${processingGainDb.toFixed(0)}`} unit="dB" />
        <Stat label="RS parity" value={`${params.parity} B`} />
        <Stat label="pilot every" value={`${PILOT_PERIOD} sym`} />
      </div>
      <p className="mt-4 text-[0.7rem] leading-relaxed text-white/40">
        Each symbol is a chirp sweeping the whole band, so the receiver recovers it by correlation rather than by
        hearing it above the room — worth {processingGainDb.toFixed(0)} dB, which is why these profiles decode with
        the signal well under the noise floor. Reed-Solomon then rebuilds up to {params.parity / 2} corrupted bytes
        per frame, or {params.parity} when the demodulator can say which ones it doubts.
      </p>
    </Panel>
  );
}
