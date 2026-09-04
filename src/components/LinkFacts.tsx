import { useMemo, useState } from 'react';
import { PROFILES, deriveParams } from '../dsp/profiles';
import { PILOT_PERIOD } from '../dsp/pilots';
import { useStore } from '../store/useStore';
import { Panel, PanelTitle, Stat } from './ui';
import {
  Sliders,
  Cpu,
  Layers,
  Zap,
  ShieldCheck,
  Radio,
  ChevronDown,
  ChevronUp,
  Activity,
  Waves,
} from 'lucide-react';

/** What the link is actually doing right now, for anyone who wants the numbers. */
export function LinkFacts() {
  const { profileId, sampleRate } = useStore();
  const [expanded, setExpanded] = useState(false);
  const params = useMemo(() => deriveParams(PROFILES[profileId], sampleRate), [profileId, sampleRate]);
  const processingGainDb = 10 * Math.log10(params.N);

  return (
    <Panel>
      <PanelTitle
        icon={<Sliders className="h-4 w-4" />}
        hint="Chirp Spread Spectrum PHY"
      >
        Physical Layer Telemetry
      </PanelTitle>

      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 sm:grid-cols-3">
        <Stat
          icon={<Waves className="h-3.5 w-3.5" />}
          label="Acoustic Band"
          value={`${(params.bandLow / 1000).toFixed(1)}–${(params.bandHigh / 1000).toFixed(1)}`}
          unit="kHz"
        />
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Occupied BW"
          value={params.bw.toFixed(0)}
          unit="Hz"
        />
        <Stat
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Spreading Factor"
          value={`SF${params.sf}`}
        />
        <Stat
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="Chips / Symbol"
          value={params.N}
          unit="chips"
        />
        <Stat
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Symbol Duration"
          value={(params.symbolSeconds * 1000).toFixed(1)}
          unit="ms"
        />
        <Stat
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Raw Bitrate"
          value={params.bitsPerSecond.toFixed(0)}
          unit="b/s"
        />
        <Stat
          icon={<Radio className="h-3.5 w-3.5 text-emerald-400" />}
          label="Processing Gain"
          value={`+${processingGainDb.toFixed(0)}`}
          unit="dB"
        />
        <Stat
          icon={<ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />}
          label="RS FEC Parity"
          value={`${params.parity}`}
          unit="bytes"
        />
        <Stat
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Pilot Sync Cadence"
          value={`1 / ${PILOT_PERIOD}`}
          unit="sym"
        />
      </div>

      {/* Collapsible Technical Physics Breakdown */}
      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold text-white/70 hover:text-white transition"
        >
          <span className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 accent-text" />
            <span>Digital Signal Processing & Link Mechanics</span>
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {expanded ? (
          <div className="mt-2.5 space-y-2.5 text-[0.72rem] leading-relaxed text-white/60 bg-white/[0.02] p-3 rounded-xl border border-white/[0.05]">
            <p>
              <strong className="text-white/90">Chirp Spread Spectrum (CSS):</strong> Each symbol is a linear frequency chirp spanning the entire band, cyclically shifted by the Gray-coded data it carries. Matched-filter correlation collapses the chirp into a single sharp FFT bin, providing a processing gain of <span className="accent-text font-bold">+{processingGainDb.toFixed(0)} dB</span>. This enables reliable decode even when acoustic signals sit below ambient room noise.
            </p>
            <p>
              <strong className="text-white/90">Sub-Chip DTFT Timing Recovery & Drift Tracking:</strong> Fractional chip propagation delays are estimated via DTFT maximization over a sub-grid and compensated using sampling instant interpolation. Crystal clock drift is tracked with a continuous PI loop.
            </p>
            <p>
              <strong className="text-white/90">Reed–Solomon (255, K) Codec:</strong> Errors and doubtful symbols (flagged as erasures by the soft-decision demodulator) are reconstructed over Galois Field GF(256), correcting up to {params.parity / 2} unknown byte errors or up to {params.parity} erasures per frame.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[0.7rem] leading-relaxed text-white/40">
            Each symbol sweeps the full band for +{processingGainDb.toFixed(0)} dB processing gain over room noise. Reed–Solomon repairs up to {params.parity / 2} corrupted bytes per frame ({params.parity} with erasures).
          </p>
        )}
      </div>
    </Panel>
  );
}
