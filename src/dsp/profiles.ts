/**
 * Transmission profiles.
 *
 * Every profile is a point on the acoustic trade-off triangle from the PRD:
 * high carriers are inaudible but die fast with distance, low carriers travel
 * and diffract but everyone in the room hears them. Spreading factor buys back
 * range on both ends - each +1 of SF doubles symbol length for +3 dB of
 * processing gain, at half the bit rate.
 */

import { pilotLayout } from './pilots';

export type ProfileId = 'ghost' | 'stealth' | 'balanced' | 'longrange';

export interface Profile {
  id: ProfileId;
  name: string;
  tagline: string;
  /** Carrier (band centre) in Hz. */
  fc: number;
  /** Requested occupied bandwidth in Hz; the real value snaps to the device sample rate. */
  bw: number;
  /** Bits per chirp symbol. Chirp length is 2^sf chips. */
  sf: number;
  /** Reed-Solomon parity bytes appended to the payload. */
  parity: number;
  /** How many times the whole frame is transmitted back to back. */
  repeats: number;
  /** Number of up-chirps in the preamble before the sync delimiter. */
  preamble: number;
  audibility: string;
  rangeLabel: string;
  accent: string;
  inaudible: boolean;
}

export const PROFILES: Record<ProfileId, Profile> = {
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    tagline: 'Fully inaudible',
    fc: 19000,
    bw: 1600,
    sf: 6,
    parity: 16,
    repeats: 2,
    preamble: 8,
    audibility: 'Silent to human ears (18.2-19.8 kHz)',
    rangeLabel: '1-3 m',
    accent: 'violet',
    inaudible: true,
  },
  stealth: {
    id: 'stealth',
    name: 'Stealth',
    tagline: 'Near-ultrasonic',
    fc: 18400,
    bw: 2400,
    sf: 6,
    parity: 16,
    repeats: 2,
    preamble: 8,
    audibility: 'Inaudible to most adults (17.2-19.6 kHz)',
    rangeLabel: '2-6 m',
    accent: 'cyan',
    inaudible: true,
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    tagline: 'Faint hiss, longer reach',
    fc: 11000,
    bw: 6000,
    sf: 7,
    parity: 16,
    repeats: 2,
    preamble: 8,
    audibility: 'A soft airy hiss (8-14 kHz)',
    rangeLabel: '4-10 m',
    accent: 'emerald',
    inaudible: false,
  },
  longrange: {
    id: 'longrange',
    name: 'Long Range',
    tagline: 'Maximum distance',
    fc: 4000,
    bw: 4000,
    sf: 8,
    parity: 24,
    repeats: 3,
    preamble: 10,
    audibility: 'Clearly audible chirps (2-6 kHz)',
    rangeLabel: '8-20 m+',
    accent: 'amber',
    inaudible: false,
  },
};

export const PROFILE_ORDER: ProfileId[] = ['ghost', 'stealth', 'balanced', 'longrange'];

/** Header is 3 bytes of metadata protected by 4 RS parity bytes. */
export const HEADER_DATA_BYTES = 3;
export const HEADER_PARITY = 4;
export const HEADER_CODED_BYTES = HEADER_DATA_BYTES + HEADER_PARITY;
export const PROTOCOL_VERSION = 1;

/** Parity levels a frame header can name, indexed by the 3-bit field in `flags`. */
export const PARITY_LEVELS = [8, 16, 24, 32, 48, 64] as const;

export interface RadioParams {
  profile: Profile;
  /** Device sample rate the parameters were derived for. */
  sampleRate: number;
  /** Integer decimation factor from sampleRate down to the chip rate. */
  decim: number;
  /** Realised bandwidth == chip rate == baseband sample rate, in Hz. */
  bw: number;
  /** Carrier, clamped so the band fits under Nyquist. */
  fc: number;
  /** Chips per symbol (2^sf). */
  N: number;
  sf: number;
  /** Symbol duration in input samples. */
  symbolSamples: number;
  /** Symbol duration in seconds. */
  symbolSeconds: number;
  bitsPerSecond: number;
  bandLow: number;
  bandHigh: number;
  preamble: number;
  parity: number;
  repeats: number;
  /** Longest message we can fit into one RS codeword. */
  maxPayloadBytes: number;
  headerSymbols: number;
}

/**
 * Snap a profile to a concrete device. The decimation factor must be an
 * integer, so the realised bandwidth is `sampleRate / round(sampleRate / bw)`
 * rather than the requested value - both ends derive it the same way, so they
 * agree without negotiating.
 */
export function deriveParams(profile: Profile, sampleRate: number): RadioParams {
  const decim = Math.max(1, Math.round(sampleRate / profile.bw));
  const bw = sampleRate / decim;
  const nyquist = sampleRate / 2;

  // Keep the whole band inside [200 Hz, 0.96 * Nyquist].
  let fc = profile.fc;
  const maxFc = nyquist * 0.96 - bw / 2;
  const minFc = 200 + bw / 2;
  if (fc > maxFc) fc = maxFc;
  if (fc < minFc) fc = minFc;

  const N = 1 << profile.sf;
  const symbolSamples = N * decim;
  const symbolSeconds = N / bw;

  const headerBits = HEADER_CODED_BYTES * 8;
  const headerSymbols = Math.ceil(headerBits / profile.sf);

  return {
    profile,
    sampleRate,
    decim,
    bw,
    fc,
    N,
    sf: profile.sf,
    symbolSamples,
    symbolSeconds,
    bitsPerSecond: (profile.sf * bw) / N,
    bandLow: fc - bw / 2,
    bandHigh: fc + bw / 2,
    preamble: profile.preamble,
    parity: profile.parity,
    repeats: profile.repeats,
    // 255-byte codeword limit, minus parity, minus the 2-byte payload CRC.
    maxPayloadBytes: 255 - profile.parity - 2,
    headerSymbols,
  };
}

/** How many chirp symbols a payload of `payloadBytes` occupies. */
export function payloadSymbolCount(payloadBytes: number, parity: number, sf: number): number {
  const codedBytes = payloadBytes + 2 /* CRC-16 */ + parity;
  return Math.ceil((codedBytes * 8) / sf);
}

export function frameSymbolCount(params: RadioParams, payloadBytes: number): number {
  const data = params.headerSymbols + payloadSymbolCount(payloadBytes, params.parity, params.sf);
  return params.preamble + 2 /* SFD down-chirps */ + pilotLayout(data).total;
}

export function estimateSeconds(params: RadioParams, payloadBytes: number): number {
  const perFrame = frameSymbolCount(params, payloadBytes) * params.symbolSeconds;
  return perFrame * params.repeats + 0.18 * (params.repeats - 1);
}
