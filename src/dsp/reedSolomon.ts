/**
 * Systematic Reed-Solomon codec over GF(256) with errors-and-erasures decoding.
 *
 * Erasures matter a lot here: the CSS demodulator knows which symbols arrived
 * with a weak FFT peak, so it can flag the bytes they touch. An erasure costs
 * the code half as much as an unknown error, which roughly doubles how much
 * damage a packet can take at range before it stops decoding.
 */

import { gfInv, gfMul, gfDiv, gfPow, polyAdd, polyEval, polyMul, polyScale } from './gf256';

const generatorCache = new Map<number, number[]>();

function generatorPoly(nsym: number): number[] {
  const cached = generatorCache.get(nsym);
  if (cached) return cached;
  let g: number[] = [1];
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, gfPow(2, i)]);
  generatorCache.set(nsym, g);
  return g;
}

/** Append `nsym` parity bytes to `msg`. */
export function rsEncode(msg: Uint8Array, nsym: number): Uint8Array {
  if (msg.length + nsym > 255) throw new Error('RS codeword longer than 255 bytes');
  const gen = generatorPoly(nsym);
  const out = new Uint8Array(msg.length + nsym);
  out.set(msg);
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) out[i + j] ^= gfMul(gen[j], coef);
  }
  out.set(msg);
  return out;
}

function calcSyndromes(msg: Uint8Array, nsym: number): number[] {
  const arr = Array.from(msg);
  const synd: number[] = [0];
  for (let i = 0; i < nsym; i++) synd.push(polyEval(arr, gfPow(2, i)));
  return synd;
}

function errataLocator(positions: number[]): number[] {
  let eLoc: number[] = [1];
  for (const p of positions) eLoc = polyMul(eLoc, polyAdd([1], [gfPow(2, p), 0]));
  return eLoc;
}

function errorEvaluator(synd: number[], errLoc: number[], nsym: number): number[] {
  const product = polyMul(synd, errLoc);
  return product.slice(product.length - (nsym + 1));
}

function correctErrata(msg: Uint8Array, synd: number[], errPos: number[]): Uint8Array<ArrayBuffer> {
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  const errLoc = errataLocator(coefPos);
  const errEval = errorEvaluator(synd.slice().reverse(), errLoc, errLoc.length - 1);

  const X = coefPos.map((p) => gfPow(2, -(255 - p)));

  const E = new Uint8Array(msg.length);
  for (let i = 0; i < X.length; i++) {
    const Xi = X[i];
    const XiInv = gfInv(Xi);
    let locPrime = 1;
    for (let j = 0; j < X.length; j++) {
      if (j !== i) locPrime = gfMul(locPrime, 1 ^ gfMul(XiInv, X[j]));
    }
    if (locPrime === 0) throw new Error('RS: could not find error magnitude');
    // Forney: Y_i = X_i * Omega(X_i^-1) / Lambda'(X_i^-1)
    let y = polyEval(errEval, XiInv);
    y = gfMul(gfPow(Xi, 1), y);
    E[errPos[i]] = gfDiv(y, locPrime);
  }
  const out = new Uint8Array(new ArrayBuffer(msg.length));
  for (let i = 0; i < msg.length; i++) out[i] = msg[i] ^ E[i];
  return out;
}

function forneySyndromes(synd: number[], erasePos: number[], nmess: number): number[] {
  const reversed = erasePos.map((p) => nmess - 1 - p);
  const fsynd = synd.slice(1);
  for (let i = 0; i < reversed.length; i++) {
    const x = gfPow(2, reversed[i]);
    for (let j = 0; j < fsynd.length - 1; j++) fsynd[j] = gfMul(fsynd[j], x) ^ fsynd[j + 1];
  }
  return fsynd;
}

/** Berlekamp-Massey, seeded with the known erasure locator when we have one. */
function findErrorLocator(synd: number[], nsym: number, eraseLoc: number[] | null, eraseCount: number): number[] {
  let errLoc: number[] = eraseLoc ? eraseLoc.slice() : [1];
  let oldLoc: number[] = eraseLoc ? eraseLoc.slice() : [1];

  const syndShift = synd.length > nsym ? synd.length - nsym : 0;

  for (let i = 0; i < nsym - eraseCount; i++) {
    const K = eraseLoc ? eraseCount + i + syndShift : i + syndShift;
    let delta = synd[K];
    for (let j = 1; j < errLoc.length; j++) delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[K - j]);

    oldLoc = oldLoc.concat([0]);

    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, gfInv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }

  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if ((errs - eraseCount) * 2 + eraseCount > nsym) throw new Error('RS: too many errors to correct');
  return errLoc;
}

/** Chien search over the codeword positions. */
function findErrors(errLoc: number[], nmess: number): number[] {
  const errs = errLoc.length - 1;
  const positions: number[] = [];
  for (let i = 0; i < nmess; i++) {
    if (polyEval(errLoc, gfPow(2, i)) === 0) positions.push(nmess - 1 - i);
  }
  if (positions.length !== errs) throw new Error('RS: error locator degree mismatch');
  return positions;
}

export interface RsResult {
  data: Uint8Array<ArrayBuffer>;
  /** Number of byte positions the decoder had to repair. */
  corrected: number;
}

/**
 * Decode a systematic codeword. `erasePos` lists byte indices already known to
 * be unreliable. Returns null when the codeword is beyond repair.
 */
export function rsDecode(codeword: Uint8Array, nsym: number, erasePos: number[] = []): RsResult | null {
  if (codeword.length > 255 || codeword.length <= nsym) return null;
  if (erasePos.length > nsym) return null;

  try {
    let msg: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(codeword.length));
    msg.set(codeword);
    for (const p of erasePos) {
      if (p < 0 || p >= msg.length) return null;
      msg[p] = 0;
    }

    const synd = calcSyndromes(msg, nsym);
    if (Math.max(...synd) === 0) {
      return { data: msg.slice(0, msg.length - nsym), corrected: 0 };
    }

    // Forney syndromes fold the known erasures out, so Berlekamp-Massey then
    // only has to solve for the remaining unknown error positions.
    const fsynd = forneySyndromes(synd, erasePos, msg.length);
    const errLoc = findErrorLocator(fsynd, nsym, null, erasePos.length);
    const errPos = findErrors(errLoc.slice().reverse(), msg.length);

    const allPos = erasePos.concat(errPos);
    msg = correctErrata(msg, synd, allPos);

    const check = calcSyndromes(msg, nsym);
    if (Math.max(...check) > 0) return null;

    return { data: msg.slice(0, msg.length - nsym), corrected: allPos.length };
  } catch {
    return null;
  }
}
