/**
 * Byte <-> chirp-symbol packing.
 *
 * Each CSS symbol carries `sf` bits. Symbols are Gray-coded on the wire so
 * that the most common demodulation slip - landing on an adjacent FFT bin -
 * costs a single bit rather than a whole byte.
 */

export function grayEncode(v: number): number {
  return v ^ (v >>> 1);
}

export function grayDecode(v: number): number {
  let r = v;
  for (let shift = 1; shift < 32; shift <<= 1) r ^= r >>> shift;
  return r;
}

/** Pack bytes MSB-first into `sf`-bit symbols, zero-padding the final symbol. */
export function bytesToSymbols(bytes: Uint8Array, sf: number): Uint16Array {
  const totalBits = bytes.length * 8;
  const count = Math.ceil(totalBits / sf);
  const out = new Uint16Array(count);
  for (let s = 0; s < count; s++) {
    let v = 0;
    for (let b = 0; b < sf; b++) {
      const bitIndex = s * sf + b;
      let bit = 0;
      if (bitIndex < totalBits) bit = (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      v = (v << 1) | bit;
    }
    out[s] = v;
  }
  return out;
}

/** Inverse of {@link bytesToSymbols}. */
export function symbolsToBytes(symbols: ArrayLike<number>, sf: number, byteCount: number): Uint8Array {
  const out = new Uint8Array(byteCount);
  const totalBits = byteCount * 8;
  for (let s = 0; s < symbols.length; s++) {
    const v = symbols[s];
    for (let b = 0; b < sf; b++) {
      const bitIndex = s * sf + b;
      if (bitIndex >= totalBits) break;
      const bit = (v >> (sf - 1 - b)) & 1;
      if (bit) out[bitIndex >> 3] |= 1 << (7 - (bitIndex & 7));
    }
  }
  return out;
}

/** Byte indices touched by symbol `symbolIndex` - used to turn weak symbols into RS erasures. */
export function bytesCoveredBySymbol(symbolIndex: number, sf: number, byteCount: number): number[] {
  const first = Math.floor((symbolIndex * sf) / 8);
  const last = Math.floor((symbolIndex * sf + sf - 1) / 8);
  const out: number[] = [];
  for (let b = first; b <= last && b < byteCount; b++) if (b >= 0) out.push(b);
  return out;
}
