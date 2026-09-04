/**
 * Pilot symbols.
 *
 * The demodulator's timing loop can only measure the *fractional* part of its
 * bin offset - the argmax hides whole bins - so it is equally happy locked one
 * bin off. Under a clock offset the residual creeps toward half a bin and a
 * noise transient tips it over; the loop then re-locks on the neighbour and
 * every symbol until the next tip is silently off by one. In testing that
 * showed up as long contiguous runs of -1 errors, far past what Reed-Solomon
 * could absorb, and no amount of loop tuning removed it because the ambiguity
 * is structural.
 *
 * Interleaving a known chirp every `PILOT_PERIOD` symbols removes the ambiguity
 * outright: a pilot must decode to bin 0, so whatever bin it lands on *is* the
 * integer offset in force around it. Data symbols are then corrected against
 * the pilots that bracket them, which repairs a slip retroactively across the
 * whole block rather than merely stopping it.
 *
 * Cost is one symbol in seventeen, about 6% of airtime.
 */

export const PILOT_PERIOD = 16;

/**
 * Pilots deliberately do *not* carry symbol 0.
 *
 * Symbol 0 is the plain base chirp - exactly what the preamble is made of - so
 * a pilot every seventeen symbols looks to the acquisition correlator like a
 * preamble arriving on the symbol clock. The receiver would then re-sync in the
 * middle of a frame it was already decoding. Half-band up the chirp is just as
 * known to both ends and correlates like any other data symbol.
 */
export function pilotValue(N: number): number {
  return N >> 1;
}

export interface PilotLayout {
  /** Total transmitted symbols, pilots included. */
  total: number;
  /** Data index carried by each transmitted slot, or -1 where a pilot sits. */
  dataIndex: Int32Array;
  pilotPositions: number[];
}

export function pilotLayout(dataCount: number, period = PILOT_PERIOD): PilotLayout {
  const slots: number[] = [];
  let d = 0;
  if (dataCount <= 0) {
    slots.push(-1);
  } else {
    while (d < dataCount) {
      slots.push(-1);
      for (let k = 0; k < period && d < dataCount; k++) slots.push(d++);
    }
  }
  slots.push(-1); // trailing pilot, so the last block is bracketed too

  const dataIndex = Int32Array.from(slots);
  const pilotPositions: number[] = [];
  for (let i = 0; i < dataIndex.length; i++) if (dataIndex[i] < 0) pilotPositions.push(i);
  return { total: dataIndex.length, dataIndex, pilotPositions };
}

/** Signed distance of `bin` from 0, folded to (-N/2, N/2]. */
export function foldBin(bin: number, N: number): number {
  let v = ((bin % N) + N) % N;
  if (v > N / 2) v -= N;
  return v;
}

export interface CorrectedSymbols {
  values: number[];
  confidences: number[];
}

/**
 * Strip pilots and undo whatever integer bin offset each block was read at.
 * Offsets are interpolated between the two pilots bracketing a symbol, so a
 * drift that crosses a bin mid-block is followed rather than stepped.
 */
export function correctWithPilots(
  raw: ArrayLike<number>,
  confidences: ArrayLike<number>,
  N: number,
  dataCount: number,
  period = PILOT_PERIOD,
): CorrectedSymbols | null {
  const layout = pilotLayout(dataCount, period);
  if (raw.length < layout.total) return null;

  const expected = pilotValue(N);
  const offsets = layout.pilotPositions.map((p) => foldBin(raw[p] - expected, N));

  const values = new Array<number>(dataCount);
  const confs = new Array<number>(dataCount);

  let pilotCursor = 0;
  for (let i = 0; i < layout.total; i++) {
    const d = layout.dataIndex[i];
    if (d < 0) {
      pilotCursor++;
      continue;
    }
    const before = pilotCursor - 1;
    const after = Math.min(pilotCursor, offsets.length - 1);
    const pa = layout.pilotPositions[before];
    const pb = layout.pilotPositions[after];
    let offset: number;
    if (before < 0) offset = offsets[after];
    else if (pb === pa) offset = offsets[before];
    else {
      const t = (i - pa) / (pb - pa);
      offset = offsets[before] + (offsets[after] - offsets[before]) * t;
    }
    values[d] = (((raw[i] - Math.round(offset)) % N) + N) % N;
    confs[d] = confidences[i];
  }

  return { values, confidences: confs };
}
