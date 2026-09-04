/**
 * Chirp Spread Spectrum modulator.
 *
 * A symbol is a cyclically shifted linear chirp: the sweep starts at chip
 * offset `value` and wraps around the band. De-chirping at the receiver turns
 * that shift into a single FFT bin, which is what buys ~10*log10(N) dB of
 * processing gain and makes the signal survive echoes and room noise well
 * below the ambient floor.
 *
 * The waveform is built the band-limited way: the ideal chip-rate baseband
 * sequence first, then sinc interpolation up to the device sample rate, then a
 * single mix to the carrier. See {@link chipSequence} for why the obvious
 * shortcut - integrating a wrapped instantaneous-frequency law directly at the
 * output rate - quietly costs several dB.
 */

import { encodeHeaderSymbols, encodePayloadSymbols } from './frame';
import { pilotLayout, pilotValue } from './pilots';
import type { RadioParams } from './profiles';

const TWO_PI = Math.PI * 2;

/** Half-width of the interpolation kernel, in chips. */
const KERNEL_HALF = 12;

export interface ModulationOptions {
  /** Output gain, 0..1. */
  volume: number;
  /** Soft-clip drive, 1 = pure sine. Ignored on inaudible profiles. */
  drive: number;
  /** Seconds of silence between repeated frames. */
  gapSeconds?: number;
}

interface SymbolSpec {
  down: boolean;
  value: number;
}

export interface Transmission {
  samples: Float32Array;
  seconds: number;
  frameSymbols: number;
  frames: number;
  headerSymbols: number;
  payloadSymbols: number;
}

function frameSpecs(payload: Uint8Array, params: RadioParams): {
  specs: SymbolSpec[];
  headerSymbols: number;
  payloadSymbols: number;
} {
  const header = encodeHeaderSymbols(payload.length, params.parity, params.sf);
  const body = encodePayloadSymbols(payload, params.parity, params.sf);
  const data = [...header, ...body];

  const specs: SymbolSpec[] = [];
  for (let i = 0; i < params.preamble; i++) specs.push({ down: false, value: 0 });
  specs.push({ down: true, value: 0 }, { down: true, value: 0 });

  // Data carried in blocks separated by pilot chirps; see dsp/pilots.ts.
  const layout = pilotLayout(data.length);
  const pilot = pilotValue(params.N);
  for (let i = 0; i < layout.total; i++) {
    const d = layout.dataIndex[i];
    specs.push({ down: false, value: d < 0 ? pilot : data[d] });
  }

  return { specs, headerSymbols: header.length, payloadSymbols: body.length };
}

/** Phase of the base up-chirp at chip `n`, in closed form. */
function baseChirpPhase(n: number, N: number): number {
  return TWO_PI * ((n * n) / (2 * N) - n / 2);
}

/**
 * The frame as ideal complex baseband, one sample per chip.
 *
 * A cyclically shifted chirp is `base[n] * exp(j*2*pi*s*n/N)` - a pure
 * frequency offset, with the wrap around the band appearing all by itself as
 * aliasing when the sequence is sampled at the chip rate. Written this way the
 * signal is band-limited by construction and every symbol ends on the phase the
 * next one starts from.
 *
 * The tempting alternative is to integrate a wrapped instantaneous-frequency
 * law straight at the output rate. That produces a *different*, discontinuous
 * waveform: at the wrap the frequency jumps by the whole bandwidth, and a
 * receiver whose sample grid lands a fraction of a chip away from the
 * transmitter's picks up a phase step of -2*pi*delta partway through the
 * symbol. The de-chirped peak then splits between two bins - worst when the
 * wrap falls mid-symbol and delta is near half a chip, which cost ~6 dB and
 * whole-bin errors on half of all arrival phases.
 */
function chipSequence(specs: SymbolSpec[], N: number): { re: Float64Array; im: Float64Array } {
  const total = specs.length * N;
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  let w = 0;
  for (const spec of specs) {
    for (let n = 0; n < N; n++) {
      const phase = spec.down
        ? -baseChirpPhase(n, N)
        : baseChirpPhase(n, N) + (TWO_PI * spec.value * n) / N;
      re[w] = Math.cos(phase);
      im[w] = Math.sin(phase);
      w++;
    }
  }
  return { re, im };
}

function lanczos(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= KERNEL_HALF) return 0;
  const px = Math.PI * x;
  return ((Math.sin(px) / px) * Math.sin(px / KERNEL_HALF)) / (px / KERNEL_HALF);
}

/** Interpolation kernels, one per output phase within a chip. */
function buildKernels(decim: number): Float64Array[] {
  const taps = KERNEL_HALF * 2;
  const kernels: Float64Array[] = [];
  for (let p = 0; p < decim; p++) {
    const k = new Float64Array(taps);
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const v = lanczos(p / decim + KERNEL_HALF - 1 - t);
      k[t] = v;
      sum += v;
    }
    // Unity DC gain keeps the envelope flat across phases.
    if (sum !== 0) for (let t = 0; t < taps; t++) k[t] /= sum;
    kernels.push(k);
  }
  return kernels;
}

/** Sinc-interpolate the chip sequence up to `sampleRate` and mix to the carrier. */
function toPassband(chips: { re: Float64Array; im: Float64Array }, params: RadioParams): Float32Array {
  const { decim, fc, sampleRate } = params;
  const chipCount = chips.re.length;
  const total = chipCount * decim;
  const out = new Float32Array(total);
  const kernels = buildKernels(decim);
  const taps = KERNEL_HALF * 2;

  const step = (TWO_PI * fc) / sampleRate;
  let carrier = 0;

  for (let m = 0; m < total; m++) {
    const j0 = (m / decim) | 0;
    const kernel = kernels[m - j0 * decim];
    let br = 0;
    let bi = 0;
    for (let t = 0; t < taps; t++) {
      const j = j0 - KERNEL_HALF + 1 + t;
      if (j < 0 || j >= chipCount) continue;
      const h = kernel[t];
      br += chips.re[j] * h;
      bi += chips.im[j] * h;
    }
    out[m] = br * Math.cos(carrier) - bi * Math.sin(carrier);
    carrier += step;
    if (carrier >= TWO_PI) carrier -= TWO_PI;
  }
  return out;
}

function applyRamp(buf: Float32Array, start: number, length: number, ramp: number) {
  const r = Math.min(ramp, length >> 1);
  for (let i = 0; i < r; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / r);
    buf[start + i] *= w;
    buf[start + length - 1 - i] *= w;
  }
}

/**
 * Soft clipping trades crest factor for in-band power: a peak-limited speaker
 * can push ~2 dB more fundamental as the wave squares up. Only safe on the
 * audible profiles - at 18 kHz the third harmonic folds back around Nyquist
 * and lands squarely in the audible range, which would defeat the whole point
 * of a stealth mode.
 */
function shape(x: number, drive: number): number {
  if (drive <= 1.001) return x;
  return Math.tanh(drive * x) / Math.tanh(drive);
}

/** Normalise to full scale, then apply shaping and gain. */
function finish(buf: Float32Array, params: RadioParams, opts: ModulationOptions) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  const norm = peak > 0 ? 1 / peak : 1;
  const drive = params.profile.inaudible ? 1 : Math.max(1, opts.drive);
  const gain = Math.max(0, Math.min(1, opts.volume));
  for (let i = 0; i < buf.length; i++) buf[i] = shape(buf[i] * norm, drive) * gain;
}

/**
 * In-band gain the soft clipper buys, in dB.
 *
 * Both the shaped and unshaped waves are peak-normalised, so this is the honest
 * figure: how much more fundamental a peak-limited speaker puts into the air.
 */
export function driveGainDb(drive: number): number {
  if (drive <= 1.001) return 0;
  const M = 512;
  let a = 0;
  for (let i = 0; i < M; i++) {
    const t = (TWO_PI * i) / M;
    a += shape(Math.sin(t), drive) * Math.sin(t);
  }
  return 20 * Math.log10((2 * a) / M);
}

export function renderTransmission(
  payload: Uint8Array,
  params: RadioParams,
  opts: ModulationOptions,
): Transmission {
  const { specs, headerSymbols, payloadSymbols } = frameSpecs(payload, params);

  const frame = toPassband(chipSequence(specs, params.N), params);
  const frameSamples = frame.length;
  applyRamp(frame, 0, frameSamples, Math.min(Math.round(0.008 * params.sampleRate), params.symbolSamples >> 1));
  finish(frame, params, opts);

  const gap = Math.round((opts.gapSeconds ?? 0.18) * params.sampleRate);
  const frames = Math.max(1, params.repeats);
  const out = new Float32Array(frames * frameSamples + (frames - 1) * gap);
  for (let f = 0; f < frames; f++) out.set(frame, f * (frameSamples + gap));

  return {
    samples: out,
    seconds: out.length / params.sampleRate,
    frameSymbols: specs.length,
    frames,
    headerSymbols,
    payloadSymbols,
  };
}

/**
 * A bare train of preamble chirps for the range test - no payload, so the
 * receiver's correlator reports pure link quality while you walk the room.
 */
export function renderRangePing(params: RadioParams, opts: ModulationOptions, seconds: number): Float32Array {
  const count = Math.max(4, Math.round((seconds * params.sampleRate) / params.symbolSamples));
  const specs: SymbolSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Sprinkle the sync delimiter in so the receiver exercises the full
    // preamble -> SFD detection path, not just the up-chirp correlator.
    specs.push({ down: i % params.preamble === params.preamble - 1, value: 0 });
  }
  const out = toPassband(chipSequence(specs, params.N), params);
  applyRamp(out, 0, out.length, Math.round(0.01 * params.sampleRate));
  finish(out, params, opts);
  return out;
}
