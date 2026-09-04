/**
 * Link layer for the receive path.
 *
 * The worklet hands us a stream of symbol indices; this turns them into
 * messages. The header is decoded as soon as its symbols land, which tells us
 * how many payload symbols to wait for - so a 5-byte message does not sit
 * through the airtime of a 200-byte one.
 */

import { decodeHeaderSymbols, decodePayloadSymbols, payloadSymbolCount, type FrameHeader } from '../dsp/frame';
import { correctWithPilots, foldBin, pilotLayout, pilotValue } from '../dsp/pilots';
import type { RadioParams } from '../dsp/profiles';

export type DemodEvent =
  | { type: 'sync'; snrDb: number }
  | { type: 'frameStart'; snrDb: number }
  | { type: 'symbol'; index: number; value: number; confDb: number }
  | { type: 'metrics'; state: ReceiverPhase; snrDb: number; noiseDb: number; rms: number; symbolIndex: number };

export type ReceiverPhase = 'searching' | 'syncing' | 'decoding';

export interface DecodedMessage {
  text: string;
  bytes: Uint8Array;
  snrDb: number;
  meanConfidenceDb: number;
  correctedBytes: number;
  erasuresUsed: number;
  payloadBytes: number;
}

export type AssemblerOutcome =
  | { kind: 'collecting' }
  | { kind: 'headerLocked'; payloadBytes: number; payloadSymbols: number }
  | { kind: 'decoded'; message: DecodedMessage }
  | { kind: 'failed'; reason: string };

export class FrameAssembler {
  private params: RadioParams;
  /** Raw bins straight off the demodulator, pilots included. */
  private raw: number[] = [];
  private confs: number[] = [];
  private header: FrameHeader | null = null;
  private dataCount = 0;
  private total = 0;
  private snrDb = -99;

  constructor(params: RadioParams) {
    this.params = params;
  }

  reset(snrDb = -99) {
    this.raw = [];
    this.confs = [];
    this.header = null;
    this.dataCount = 0;
    this.total = 0;
    this.snrDb = snrDb;
  }

  /** Symbols received so far, and how many the current stage is waiting for. */
  get progress(): { stage: 'header' | 'payload'; have: number; need: number } {
    if (!this.header) {
      return { stage: 'header', have: this.raw.length, need: 1 + this.params.headerSymbols };
    }
    return { stage: 'payload', have: this.raw.length, need: this.total };
  }

  push(index: number, value: number, confDb: number): AssemblerOutcome {
    // A gap means the worklet re-synced mid-frame; the partial frame is junk.
    if (index !== this.raw.length) return { kind: 'failed', reason: 'symbol stream desynchronised' };
    this.raw.push(value);
    this.confs.push(confDb);

    if (!this.header) return this.tryHeader();
    if (this.raw.length < this.total) return { kind: 'collecting' };
    return this.tryPayload();
  }

  /**
   * The header rides in the first pilot block, so its layout is known before
   * anything has been decoded - which is what breaks the circular dependency
   * between "how long is this frame" and "where are its pilots".
   */
  private tryHeader(): AssemblerOutcome {
    const need = 1 + this.params.headerSymbols;
    if (this.raw.length < need) return { kind: 'collecting' };

    const N = this.params.N;
    const offset = foldBin(this.raw[0] - pilotValue(N), N); // leading pilot
    const values: number[] = [];
    for (let i = 1; i < need; i++) values.push((((this.raw[i] - offset) % N) + N) % N);

    const header = decodeHeaderSymbols(values, this.confs.slice(1, need), this.params.sf);
    if (!header) return { kind: 'failed', reason: 'header did not survive error correction' };

    const payloadSymbols = payloadSymbolCount(header.payloadBytes, header.parity, this.params.sf);
    this.header = header;
    this.dataCount = this.params.headerSymbols + payloadSymbols;
    this.total = pilotLayout(this.dataCount).total;
    return { kind: 'headerLocked', payloadBytes: header.payloadBytes, payloadSymbols };
  }

  private tryPayload(): AssemblerOutcome {
    const header = this.header!;
    const corrected = correctWithPilots(this.raw, this.confs, this.params.N, this.dataCount);
    if (!corrected) return { kind: 'failed', reason: 'pilot alignment failed' };

    const values = corrected.values.slice(this.params.headerSymbols);
    const confs = corrected.confidences.slice(this.params.headerSymbols);

    const res = decodePayloadSymbols(values, confs, this.params.sf, header);
    if (!res) return { kind: 'failed', reason: 'payload failed CRC after error correction' };

    const meanConf = confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length);
    return {
      kind: 'decoded',
      message: {
        text: res.text,
        bytes: res.bytes,
        snrDb: this.snrDb,
        meanConfidenceDb: meanConf,
        correctedBytes: res.correctedBytes,
        erasuresUsed: res.erasuresUsed,
        payloadBytes: header.payloadBytes,
      },
    };
  }
}
