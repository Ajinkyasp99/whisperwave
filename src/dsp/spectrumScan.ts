/**
 * Wideband spectrum scanning primitives.
 *
 * Pure functions over an FFT magnitude spectrum in dB - a noise-floor
 * estimator, a squelch-gated peak detector, an emitter tracker and a
 * morphology classifier. Nothing here touches WebAudio or React, so the node
 * test suite drives it directly with synthetic spectra.
 *
 * The floor is estimated *across frequency* rather than across time (a block
 * percentile, CFAR style). A temporal floor slowly swallows any continuous
 * carrier, which is exactly the signal a scanner exists to find; a spatial
 * percentile ignores narrow peaks by construction and still tracks a tilted
 * or drifting noise shape.
 */

export interface Detection {
  /** Interpolated peak frequency in Hz. */
  freq: number;
  lowFreq: number;
  highFreq: number;
  bandwidth: number;
  /** Absolute peak level, dBFS. */
  levelDb: number;
  /** Peak level above the local noise floor. */
  snrDb: number;
}

export interface BandInfo {
  low: number;
  high: number;
  name: string;
  note: string;
}

/**
 * What normally lives where, in the acoustic spectrum a phone microphone can
 * actually see. Used both to label detections and to give the sweep sensible
 * dwell channels instead of arbitrary equal slices.
 */
export const BAND_GUIDE: readonly BandInfo[] = [
  { low: 0, high: 40, name: 'Infrasonic', note: 'Handling rumble, HVAC, footsteps. Most microphones roll this off.' },
  { low: 40, high: 80, name: 'Mains hum', note: 'Power-line hum at 50/60 Hz - the loudest thing in most rooms.' },
  { low: 80, high: 300, name: 'Voice fundamental', note: 'Pitch range of human speech, plus motors, fans and compressors.' },
  { low: 300, high: 3400, name: 'Speech band', note: 'Telephony band - voices, alarms and most music energy.' },
  { low: 3400, high: 8000, name: 'Presence / alerts', note: 'Consonants, beeps, smoke-alarm chirps, keyboard clicks.' },
  { low: 8000, high: 14000, name: 'Air band', note: 'Cymbals, hiss and rustle. WhisperWave Balanced lives here.' },
  { low: 14000, high: 15600, name: 'Upper audible', note: 'Audible to younger ears only; switch-mode supplies whine here.' },
  { low: 15600, high: 15900, name: 'Flyback line', note: '15.734 kHz CRT/TV line whistle and similar fixed oscillators.' },
  { low: 15900, high: 17000, name: 'Edge of hearing', note: 'Mosquito tones, pest repellers, some appliance chimes.' },
  { low: 17000, high: 20000, name: 'Near-ultrasonic', note: 'Data beacons, cross-device tracking pings, WhisperWave Ghost/Stealth.' },
  { low: 20000, high: 200000, name: 'Ultrasonic', note: 'Motion and presence sensors, ultrasonic remotes, transducer leakage.' },
];

export function describeBand(freq: number): BandInfo {
  for (const b of BAND_GUIDE) if (freq >= b.low && freq < b.high) return b;
  return BAND_GUIDE[BAND_GUIDE.length - 1];
}

/** Sweep channels are the band guide clipped to what this device can hear. */
export function sweepChannels(nyquist: number): BandInfo[] {
  const out: BandInfo[] = [];
  for (const b of BAND_GUIDE) {
    const high = Math.min(b.high, nyquist);
    if (high - b.low < 60) continue;
    out.push({ ...b, high });
  }
  return out;
}

/* ----------------------------- noise floor ------------------------------ */

export interface FloorOptions {
  /** Bins per percentile block. Larger is smoother and cheaper, less adaptive. */
  blockSize?: number;
  /** Which percentile of each block counts as "floor". */
  percentile?: number;
  /** Temporal smoothing of the estimate, 0 = frozen, 1 = no smoothing. */
  alpha?: number;
  /** Blocks either side pooled to reject signals wider than one block. */
  spanBlocks?: number;
  /** Added back after the pooling, which biases the estimate low. */
  biasDb?: number;
}

/** Nothing real sits below this; Chrome reports -400 dB for digital silence. */
const FLOOR_CLAMP_DB = -150;

const scratch: number[] = [];
const pool: number[] = [];

/**
 * Write a per-bin noise floor into `floor`, in place.
 *
 * Two scales. Each block of bins contributes its low percentile, which already
 * ignores narrow tones. Those anchors are then pooled across a neighbourhood
 * of blocks, because a signal wider than one block - which is every spread
 * spectrum transmission this app makes - otherwise becomes its own noise floor
 * and disappears. Pooling is a low quantile rather than a hard minimum so one
 * unlucky block cannot drag the estimate down. The result is interpolated
 * across block centres so a sloped floor stays sloped instead of becoming a
 * staircase.
 */
export function estimateNoiseFloor(spec: Float32Array, floor: Float32Array, opts: FloorOptions = {}): void {
  const blockSize = opts.blockSize ?? 64;
  const percentile = opts.percentile ?? 0.3;
  const alpha = opts.alpha ?? 0.25;
  const span = opts.spanBlocks ?? 4;
  const bias = opts.biasDb ?? 1.5;
  const n = spec.length;
  const blocks = Math.max(1, Math.ceil(n / blockSize));

  const anchors = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    const start = b * blockSize;
    const end = Math.min(n, start + blockSize);
    scratch.length = 0;
    for (let i = start; i < end; i++) {
      const v = spec[i];
      scratch.push(Number.isFinite(v) ? Math.max(FLOOR_CLAMP_DB, v) : FLOOR_CLAMP_DB);
    }
    scratch.sort((x, y) => x - y);
    const idx = Math.min(scratch.length - 1, Math.max(0, Math.round((scratch.length - 1) * percentile)));
    anchors[b] = scratch[idx];
  }

  const pooled = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    pool.length = 0;
    for (let k = b - span; k <= b + span; k++) {
      pool.push(anchors[Math.max(0, Math.min(blocks - 1, k))]);
    }
    pool.sort((x, y) => x - y);
    pooled[b] = pool[Math.min(pool.length - 1, Math.round((pool.length - 1) * 0.25))] + bias;
  }

  for (let i = 0; i < n; i++) {
    // Position of this bin between two block centres.
    const pos = i / blockSize - 0.5;
    const b0 = Math.max(0, Math.min(blocks - 1, Math.floor(pos)));
    const b1 = Math.max(0, Math.min(blocks - 1, b0 + 1));
    const t = Math.max(0, Math.min(1, pos - b0));
    const target = pooled[b0] * (1 - t) + pooled[b1] * t;
    const prev = floor[i];
    floor[i] = Number.isFinite(prev) ? prev + (target - prev) * alpha : target;
  }
}

/* ---------------------------- peak detection ---------------------------- */

export interface DetectOptions {
  binHz: number;
  /** How far above the local floor a bin must sit to break squelch. */
  squelchDb?: number;
  minFreq?: number;
  maxFreq?: number;
  /** Bins of dead space tolerated inside one detection. */
  gapBins?: number;
  maxPeaks?: number;
}

/**
 * Contiguous runs of bins that break squelch become one detection each, with
 * a parabolically interpolated centre frequency and a -3 dB width.
 */
export function detectPeaks(spec: Float32Array, floor: Float32Array, opts: DetectOptions): Detection[] {
  const { binHz } = opts;
  const squelchDb = opts.squelchDb ?? 8;
  const minBin = Math.max(1, Math.ceil((opts.minFreq ?? 30) / binHz));
  const maxBin = Math.min(spec.length - 2, Math.floor((opts.maxFreq ?? Infinity) / binHz));
  const gapBins = opts.gapBins ?? 2;
  const maxPeaks = opts.maxPeaks ?? 24;

  const out: Detection[] = [];
  let runStart = -1;
  let gap = 0;

  const close = (endExclusive: number) => {
    if (runStart < 0) return;
    const start = runStart;
    const end = endExclusive;
    runStart = -1;

    let peakBin = start;
    let peakDb = -Infinity;
    for (let i = start; i < end; i++) {
      if (spec[i] > peakDb) {
        peakDb = spec[i];
        peakBin = i;
      }
    }
    const snrDb = peakDb - floor[peakBin];
    if (snrDb < squelchDb) return;

    // Parabolic interpolation on the log magnitudes: a tone between two bins
    // otherwise reads as whichever bin won by a hair, which makes a rock
    // steady carrier look like it is dithering by a whole bin.
    const y0 = spec[peakBin - 1] ?? peakDb;
    const y1 = peakDb;
    const y2 = spec[peakBin + 1] ?? peakDb;
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;

    // -3 dB edges, but never wider than the run that broke squelch.
    const edgeDb = peakDb - 3;
    let lo = peakBin;
    while (lo > start && spec[lo - 1] >= edgeDb) lo--;
    let hi = peakBin;
    while (hi < end - 1 && spec[hi + 1] >= edgeDb) hi++;

    out.push({
      freq: (peakBin + delta) * binHz,
      lowFreq: lo * binHz,
      highFreq: (hi + 1) * binHz,
      bandwidth: Math.max(binHz, (hi - lo + 1) * binHz),
      levelDb: peakDb,
      snrDb,
    });
  };

  for (let i = minBin; i <= maxBin; i++) {
    const over = spec[i] - floor[i] >= squelchDb;
    if (over) {
      if (runStart < 0) runStart = i;
      gap = 0;
    } else if (runStart >= 0) {
      gap++;
      if (gap > gapBins) close(i - gap);
    }
  }
  close(maxBin + 1);

  out.sort((a, b) => b.snrDb - a.snrDb);
  return out.length > maxPeaks ? out.slice(0, maxPeaks) : out;
}


/* --------------------------- carrier detection --------------------------- */

export interface BandActivity {
  /** Fraction of the band's bins above squelch. */
  occupancy: number;
  /** How much of the band's width the above-squelch bins are spread over. */
  span: number;
  meanExcessDb: number;
  peakExcessDb: number;
  peakFreq: number;
}

export function bandActivity(
  spec: Float32Array,
  floor: Float32Array,
  binHz: number,
  squelchDb: number,
  low: number,
  high: number,
): BandActivity {
  const first = Math.max(1, Math.round(low / binHz));
  const last = Math.min(spec.length - 1, Math.round(high / binHz));
  if (last <= first) return { occupancy: 0, span: 0, meanExcessDb: 0, peakExcessDb: 0, peakFreq: 0 };

  let over = 0;
  let sum = 0;
  let peak = -Infinity;
  let peakBin = first;
  let lowBin = -1;
  let highBin = -1;

  for (let i = first; i <= last; i++) {
    const v = Number.isFinite(spec[i]) ? spec[i] : FLOOR_CLAMP_DB;
    const excess = v - floor[i];
    sum += excess;
    if (excess > peak) {
      peak = excess;
      peakBin = i;
    }
    if (excess >= squelchDb) {
      over++;
      if (lowBin < 0) lowBin = i;
      highBin = i;
    }
  }

  const n = last - first + 1;
  return {
    occupancy: over / n,
    span: lowBin < 0 ? 0 : (highBin - lowBin + 1) / n,
    meanExcessDb: sum / n,
    peakExcessDb: Number.isFinite(peak) ? peak : 0,
    peakFreq: peakBin * binHz,
  };
}

export interface CarrierVerdict extends BandActivity {
  /** Occupancy of the guard regions either side of the band. */
  guardOccupancy: number;
  /** How much more occupied the band is than its surroundings. */
  contrast: number;
  /** How much stronger the band is than its surroundings, in dB. */
  contrastDb: number;
  isCarrier: boolean;
}

/**
 * Decide whether a WhisperWave transmission is occupying a band.
 *
 * A chirp sweeps the whole band inside one symbol, so over an FFT window it
 * lights the band up as a rippling plateau rather than a single peak - which
 * is why this asks about occupancy and spread instead of looking for a tone.
 * Broadband room noise lights every band at once, so the band is also compared
 * against guard regions either side of it: a real transmission is louder than
 * its own neighbourhood, a hand clap is not. That comparison is made in dB
 * rather than on the occupied *fraction* - a loud audible transmission
 * splatters weak energy over the guards, which saturates any fraction-based
 * contrast while leaving the band 15 dB stronger than its surroundings.
 */
export function detectCarrier(
  spec: Float32Array,
  floor: Float32Array,
  binHz: number,
  squelchDb: number,
  band: { low: number; high: number },
  nyquist: number,
): CarrierVerdict {
  const inBand = bandActivity(spec, floor, binHz, squelchDb, band.low, band.high);
  const width = band.high - band.low;
  const belowLow = Math.max(30, band.low - width * 0.6);
  const aboveHigh = Math.min(nyquist * 0.98, band.high + width * 0.6);

  const guards: BandActivity[] = [];
  if (band.low - belowLow > width * 0.15) guards.push(bandActivity(spec, floor, binHz, squelchDb, belowLow, band.low));
  if (aboveHigh - band.high > width * 0.15) guards.push(bandActivity(spec, floor, binHz, squelchDb, band.high, aboveHigh));
  const guardOccupancy = guards.length
    ? guards.reduce((a, g) => a + g.occupancy, 0) / guards.length
    : 0;
  const guardMeanDb = guards.length
    ? guards.reduce((a, g) => a + g.meanExcessDb, 0) / guards.length
    : 0;

  const contrastDb = inBand.meanExcessDb - guardMeanDb;
  return {
    ...inBand,
    guardOccupancy,
    contrast: inBand.occupancy - guardOccupancy,
    contrastDb,
    isCarrier: inBand.occupancy >= 0.12 && inBand.span >= 0.4 && contrastDb >= 5,
  };
}

/* ------------------------------- summary -------------------------------- */

export interface ScanSummary {
  /** Fraction of the scanned span sitting above squelch. */
  occupancy: number;
  /** Median of the per-bin floor, dBFS. */
  noiseFloorDb: number;
  peakDb: number;
  peakFreq: number;
  /** Mean level over the speech band, above floor. */
  voiceSnrDb: number;
  /** Mean level above 17 kHz, above floor. */
  ultrasonicSnrDb: number;
}

export function summarize(spec: Float32Array, floor: Float32Array, binHz: number, squelchDb: number): ScanSummary {
  let over = 0;
  let counted = 0;
  let peakDb = -Infinity;
  let peakBin = 0;
  let voiceSum = 0;
  let voiceN = 0;
  let ultraSum = 0;
  let ultraN = 0;

  const minBin = Math.max(1, Math.ceil(30 / binHz));
  for (let i = minBin; i < spec.length; i++) {
    const v = Number.isFinite(spec[i]) ? Math.max(FLOOR_CLAMP_DB, spec[i]) : FLOOR_CLAMP_DB;
    const excess = v - floor[i];
    counted++;
    if (excess >= squelchDb) over++;
    if (v > peakDb) {
      peakDb = v;
      peakBin = i;
    }
    const f = i * binHz;
    if (f >= 300 && f <= 3400) {
      voiceSum += excess;
      voiceN++;
    } else if (f >= 17000) {
      ultraSum += excess;
      ultraN++;
    }
  }

  const floorSorted = Array.from(floor).sort((a, b) => a - b);
  return {
    occupancy: counted ? over / counted : 0,
    noiseFloorDb: floorSorted.length ? floorSorted[Math.floor(floorSorted.length / 2)] : FLOOR_CLAMP_DB,
    peakDb: Number.isFinite(peakDb) ? peakDb : FLOOR_CLAMP_DB,
    peakFreq: peakBin * binHz,
    voiceSnrDb: voiceN ? voiceSum / voiceN : 0,
    ultrasonicSnrDb: ultraN ? ultraSum / ultraN : 0,
  };
}
