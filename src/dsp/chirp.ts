/**
 * Chirp references and the decimating anti-alias filter.
 *
 * Both ends derive these from the same RadioParams, so the receiver's matched
 * filter is a bit-exact conjugate of what the transmitter emits. The tables are
 * built on the main thread and shipped into the AudioWorklet at construction.
 */

import type { RadioParams } from './profiles';

export interface ComplexTable {
  re: Float32Array;
  im: Float32Array;
}

/**
 * Baseband reference chirp, already conjugated for correlation / de-chirping.
 *
 * An up-chirp sweeps -bw/2 -> +bw/2 over N chips; normalised to the baseband
 * rate (which equals bw) the instantaneous frequency of chip n is simply
 * n/N - 1/2 cycles per sample.
 */
export function conjugateChirp(N: number, down: boolean): ComplexTable {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    // Closed form of 2*pi * integral of (u/N - 1/2) du, matching the exact
    // phase the modulator emits. A sample-by-sample accumulation here would
    // differ from the transmitter's finer step by half a bin.
    const phase = 2 * Math.PI * ((n * n) / (2 * N) - n / 2);
    const p = down ? -phase : phase;
    re[n] = Math.cos(p);
    im[n] = -Math.sin(p); // conjugate, so correlation is a plain dot product
  }
  return { re, im };
}

function blackmanHarris(i: number, n: number): number {
  const x = (2 * Math.PI * i) / (n - 1);
  return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
}

/**
 * Windowed-sinc low-pass run as the decimator's anti-alias stage. Cutoff sits
 * at half the target bandwidth, i.e. exactly the Nyquist of the decimated
 * stream, so the full chirp sweep survives while everything else folds away.
 */
export function designDecimationFilter(decim: number): Float32Array {
  if (decim <= 1) return Float32Array.from([1]);
  let taps = 12 * decim + 1;
  if (taps > 769) taps = 769;
  if (taps % 2 === 0) taps += 1;

  const cutoff = 0.5 / decim; // normalised to the input sample rate
  const mid = (taps - 1) / 2;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const v = sinc * blackmanHarris(i, taps);
    h[i] = v;
    sum += v;
  }
  for (let i = 0; i < taps; i++) h[i] /= sum; // unity DC gain
  return h;
}

export interface DemodTables {
  fir: Float32Array;
  upRe: Float32Array;
  upIm: Float32Array;
  downRe: Float32Array;
  downIm: Float32Array;
}

export function buildDemodTables(params: RadioParams): DemodTables {
  const up = conjugateChirp(params.N, false);
  const down = conjugateChirp(params.N, true);
  return {
    fir: designDecimationFilter(params.decim),
    upRe: up.re,
    upIm: up.im,
    downRe: down.re,
    downIm: down.im,
  };
}
