/**
 * Link layer: turning text into chirp symbols and back.
 *
 * Wire format of one frame
 *   [ preamble up-chirps ] [ 2 down-chirps (SFD) ] [ header ] [ payload ]
 *
 *   header  = RS(7,3) over  { len, flags, crc8(len,flags) }
 *   payload = RS(k+parity,k) over { utf8 bytes, crc16 }      where k = len + 2
 *
 * The header is decoded first and tells the receiver exactly how many payload
 * symbols to expect, so variable-length messages cost no airtime.
 */

import { crc8, crc16 } from './crc';
import { rsDecode, rsEncode } from './reedSolomon';
import { bytesToSymbols, bytesCoveredBySymbol, grayDecode, grayEncode, symbolsToBytes } from './bits';
import {
  HEADER_CODED_BYTES,
  HEADER_DATA_BYTES,
  HEADER_PARITY,
  PARITY_LEVELS,
  PROTOCOL_VERSION,
  payloadSymbolCount,
} from './profiles';

export interface FrameHeader {
  payloadBytes: number;
  parity: number;
  version: number;
}

function parityIndex(parity: number): number {
  const idx = PARITY_LEVELS.indexOf(parity as (typeof PARITY_LEVELS)[number]);
  if (idx < 0) throw new Error(`unsupported parity level ${parity}`);
  return idx;
}

/* ----------------------------- transmit ----------------------------- */

export function encodeHeaderSymbols(payloadBytes: number, parity: number, sf: number): Uint16Array {
  const flags = (PROTOCOL_VERSION << 5) | (parityIndex(parity) << 2);
  const head = new Uint8Array(HEADER_DATA_BYTES);
  head[0] = payloadBytes & 0xff;
  head[1] = flags;
  head[2] = crc8(head.subarray(0, 2));
  const coded = rsEncode(head, HEADER_PARITY);
  return grayAll(bytesToSymbols(coded, sf));
}

export function encodePayloadSymbols(payload: Uint8Array, parity: number, sf: number): Uint16Array {
  const withCrc = new Uint8Array(payload.length + 2);
  withCrc.set(payload);
  const c = crc16(payload);
  withCrc[payload.length] = (c >> 8) & 0xff;
  withCrc[payload.length + 1] = c & 0xff;
  const coded = rsEncode(withCrc, parity);
  return grayAll(bytesToSymbols(coded, sf));
}

function grayAll(symbols: Uint16Array): Uint16Array {
  const out = new Uint16Array(symbols.length);
  for (let i = 0; i < symbols.length; i++) out[i] = grayEncode(symbols[i]);
  return out;
}

/* ------------------------------ receive ----------------------------- */

/**
 * Try progressively more aggressive erasure sets. Attempt 0 is a plain
 * error-correcting decode; later attempts hand the decoder the byte positions
 * the demodulator was least sure about, which is where RS gets its second wind.
 */
function decodeWithErasures(codeword: Uint8Array, parity: number, byteConfidence: Float32Array) {
  const direct = rsDecode(codeword, parity, []);
  if (direct) return { ...direct, erasures: 0 };

  const ranked = Array.from(byteConfidence, (conf, index) => ({ conf, index })).sort((a, b) => a.conf - b.conf);

  const tried = new Set<number>([0]);
  for (const k of [Math.min(4, parity), Math.min(8, parity), parity >> 1, parity]) {
    if (k <= 0 || k > parity || tried.has(k)) continue;
    tried.add(k);
    const erasePos = ranked.slice(0, k).map((r) => r.index);
    const res = rsDecode(codeword, parity, erasePos);
    if (res) return { ...res, erasures: k };
  }
  return null;
}

/** Lowest demodulator confidence seen for each coded byte. */
function byteConfidenceFrom(confidences: ArrayLike<number>, sf: number, byteCount: number): Float32Array {
  const out = new Float32Array(byteCount).fill(Number.POSITIVE_INFINITY);
  for (let s = 0; s < confidences.length; s++) {
    for (const b of bytesCoveredBySymbol(s, sf, byteCount)) {
      if (confidences[s] < out[b]) out[b] = confidences[s];
    }
  }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
  return out;
}

export function decodeHeaderSymbols(
  symbols: ArrayLike<number>,
  confidences: ArrayLike<number>,
  sf: number,
): FrameHeader | null {
  const degrayed = new Uint16Array(symbols.length);
  for (let i = 0; i < symbols.length; i++) degrayed[i] = grayDecode(symbols[i]);
  const coded = symbolsToBytes(degrayed, sf, HEADER_CODED_BYTES);
  const conf = byteConfidenceFrom(confidences, sf, HEADER_CODED_BYTES);

  const res = decodeWithErasures(coded, HEADER_PARITY, conf);
  if (!res) return null;

  const head = res.data;
  if (crc8(head.subarray(0, 2)) !== head[2]) return null;

  const flags = head[1];
  const version = (flags >> 5) & 0x07;
  if (version !== PROTOCOL_VERSION) return null;
  const parity = PARITY_LEVELS[(flags >> 2) & 0x07];
  if (parity === undefined) return null;

  const payloadBytes = head[0];
  if (payloadBytes === 0 || payloadBytes + 2 + parity > 255) return null;

  return { payloadBytes, parity, version };
}

export interface PayloadResult {
  bytes: Uint8Array;
  text: string;
  correctedBytes: number;
  erasuresUsed: number;
}

export function decodePayloadSymbols(
  symbols: ArrayLike<number>,
  confidences: ArrayLike<number>,
  sf: number,
  header: FrameHeader,
): PayloadResult | null {
  const codedBytes = header.payloadBytes + 2 + header.parity;
  const degrayed = new Uint16Array(symbols.length);
  for (let i = 0; i < symbols.length; i++) degrayed[i] = grayDecode(symbols[i]);

  const coded = symbolsToBytes(degrayed, sf, codedBytes);
  const conf = byteConfidenceFrom(confidences, sf, codedBytes);

  const res = decodeWithErasures(coded, header.parity, conf);
  if (!res) return null;

  const withCrc = res.data;
  const payload = withCrc.subarray(0, header.payloadBytes);
  const got = (withCrc[header.payloadBytes] << 8) | withCrc[header.payloadBytes + 1];
  if (crc16(payload) !== got) return null;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    text = new TextDecoder('utf-8').decode(payload);
  }

  return { bytes: payload.slice(), text, correctedBytes: res.corrected, erasuresUsed: res.erasures };
}

export { payloadSymbolCount };
