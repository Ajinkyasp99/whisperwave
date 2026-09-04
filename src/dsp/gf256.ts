/**
 * GF(2^8) arithmetic tables used by the Reed-Solomon codec.
 * Primitive polynomial 0x11d, generator alpha = 2 (the QR-code / classic RS field).
 */

const PRIM = 0x11d;

export const GF_EXP = new Uint8Array(512);
export const GF_LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIM;
  }
  // Duplicate the table so we can index up to 510 without a modulo.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256) division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
}

export function gfInv(a: number): number {
  if (a === 0) throw new Error('GF(256) inverse of zero');
  return GF_EXP[255 - GF_LOG[a]];
}

/** a^n, with n allowed to be negative. */
export function gfPow(a: number, n: number): number {
  if (a === 0) return n === 0 ? 1 : 0;
  let e = (GF_LOG[a] * n) % 255;
  if (e < 0) e += 255;
  return GF_EXP[e];
}

/* ------------------------------------------------------------------ *
 * Polynomials. Index 0 holds the highest-degree coefficient, matching
 * the classic "Reed-Solomon codes for coders" formulation.
 * ------------------------------------------------------------------ */

export function polyAdd(p: number[], q: number[]): number[] {
  const r = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) r[i + r.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) r[i + r.length - q.length] ^= q[i];
  return r;
}

export function polyScale(p: number[], s: number): number[] {
  const r = new Array<number>(p.length);
  for (let i = 0; i < p.length; i++) r[i] = gfMul(p[i], s);
  return r;
}

export function polyMul(p: number[], q: number[]): number[] {
  const r = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) {
    const qj = q[j];
    if (qj === 0) continue;
    const lq = GF_LOG[qj];
    for (let i = 0; i < p.length; i++) {
      const pi = p[i];
      if (pi !== 0) r[i + j] ^= GF_EXP[GF_LOG[pi] + lq];
    }
  }
  return r;
}

/** Horner evaluation of p at x. */
export function polyEval(p: number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i];
  return y;
}
