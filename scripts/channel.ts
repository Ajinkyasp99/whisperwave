/** Acoustic channel simulator: clock drift, attenuation, multipath, AWGN. */

export interface ChannelOptions {
  sampleRate: number;
  /** Broadband SNR in dB, measured over the whole 0..fs/2 band. */
  snrDb: number;
  /** Transmitter/receiver crystal mismatch in parts per million. */
  clockPpm?: number;
  /** [delay in ms, linear gain] echo taps. */
  echoes?: Array<[number, number]>;
  /** Overall path loss applied before noise. */
  gain?: number;
  /** Leading silence in seconds. */
  leadSeconds?: number;
  seed?: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Fractional resampling with a windowed-sinc kernel.
 *
 * Linear interpolation would be far simpler, but its response droops by ~9 dB
 * at 18 kHz and the droop varies with the interpolation phase - which would
 * amplitude-modulate the ultrasonic profiles and make this bench measure the
 * simulator instead of the receiver. A real crystal offset does no such thing.
 */
const KERNEL_HALF = 12;

function lanczos(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= KERNEL_HALF) return 0;
  const px = Math.PI * x;
  return (Math.sin(px) / px) * (Math.sin(px / KERNEL_HALF) / (px / KERNEL_HALF));
}

function resample(x: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-12) return x;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const base = Math.floor(p);
    const frac = p - base;
    let acc = 0;
    for (let k = -KERNEL_HALF + 1; k <= KERNEL_HALF; k++) {
      const idx = base + k;
      if (idx < 0 || idx >= x.length) continue;
      acc += x[idx] * lanczos(frac - k);
    }
    out[i] = acc;
  }
  return out;
}

export function applyChannel(input: Float32Array, opts: ChannelOptions): Float32Array {
  const rand = mulberry32(opts.seed ?? 12345);
  const ppm = opts.clockPpm ?? 0;
  const drifted = resample(input, 1 + ppm * 1e-6);

  const lead = Math.round((opts.leadSeconds ?? 0.35) * opts.sampleRate);
  const tail = Math.round(0.25 * opts.sampleRate);
  const maxEcho = Math.max(0, ...(opts.echoes ?? []).map(([ms]) => Math.round((ms / 1000) * opts.sampleRate)));
  const out = new Float32Array(lead + drifted.length + maxEcho + tail);

  const gain = opts.gain ?? 1;
  for (let i = 0; i < drifted.length; i++) out[lead + i] += drifted[i] * gain;
  for (const [ms, g] of opts.echoes ?? []) {
    const d = Math.round((ms / 1000) * opts.sampleRate);
    for (let i = 0; i < drifted.length; i++) out[lead + i + d] += drifted[i] * gain * g;
  }

  // Signal power measured only where the signal actually is, so leading
  // silence does not flatter the SNR figure.
  let power = 0;
  for (let i = lead; i < lead + drifted.length; i++) power += out[i] * out[i];
  power /= Math.max(1, drifted.length);

  const noiseSigma = Math.sqrt(power / Math.pow(10, opts.snrDb / 10));
  for (let i = 0; i < out.length; i++) out[i] += gaussian(rand) * noiseSigma;

  return out;
}
