/**
 * Head-less end-to-end test of the WhisperWave physical + link layers.
 *
 * Runs the real modulator through a simulated room (path loss, echoes, clock
 * drift, AWGN) and into the real AudioWorklet DSP core, then checks the text
 * comes back byte-identical.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROFILES, PROFILE_ORDER, deriveParams, estimateSeconds, type ProfileId } from '../src/dsp/profiles';
import { renderTransmission } from '../src/dsp/modulator';
import { buildDemodTables } from '../src/dsp/chirp';
import { FrameAssembler } from '../src/audio/frameAssembler';
import { rsDecode, rsEncode } from '../src/dsp/reedSolomon';
import { crc16 } from '../src/dsp/crc';
import { bytesToSymbols, grayDecode, grayEncode, symbolsToBytes } from '../src/dsp/bits';
import { applyChannel, type ChannelOptions } from './channel';

// The bundle runs from a temp dir, so resolve the worklet against the repo root.
const workletSrc = readFileSync(join(process.cwd(), 'public', 'ww-demod.worklet.js'), 'utf8');
// eslint-disable-next-line no-eval
(0, eval)(workletSrc);
const WWDemodCore = (globalThis as any).WWDemodCore as any;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` ${detail}` : ''}`);
  }
}

/* ------------------------------- unit tests ------------------------------ */

function testCodecs() {
  console.log('\nCodec unit tests');

  // Gray coding round-trip
  let grayOk = true;
  for (let i = 0; i < 4096; i++) if (grayDecode(grayEncode(i)) !== i) grayOk = false;
  check('Gray code round-trips over 12 bits', grayOk);

  // Bit packing round-trip for every spreading factor we ship
  let packOk = true;
  for (const sf of [6, 7, 8, 9]) {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
    const back = symbolsToBytes(bytesToSymbols(bytes, sf), sf, bytes.length);
    if (back.some((v, i) => v !== bytes[i])) packOk = false;
  }
  check('byte <-> symbol packing round-trips for sf 6..9', packOk);

  // RS: correct up to t = parity/2 random errors
  const parity = 16;
  const data = new Uint8Array(64).map((_, i) => (i * 91 + 5) & 0xff);
  const code = rsEncode(data, parity);
  const damaged = code.slice();
  for (let i = 0; i < parity / 2; i++) damaged[(i * 7 + 3) % damaged.length] ^= 0xa5;
  const rec = rsDecode(damaged, parity, []);
  check(
    `RS(${code.length},${data.length}) repairs ${parity / 2} unknown errors`,
    !!rec && rec.data.every((v, i) => v === data[i]),
  );

  // RS: correct up to `parity` erasures when positions are known
  const erased = code.slice();
  const positions: number[] = [];
  for (let i = 0; i < parity; i++) {
    const p = (i * 5 + 2) % erased.length;
    positions.push(p);
    erased[p] = 0x00;
  }
  const rec2 = rsDecode(erased, parity, positions);
  check(
    `RS repairs ${parity} flagged erasures (2x the error budget)`,
    !!rec2 && rec2.data.every((v, i) => v === data[i]),
  );

  // RS must refuse rather than invent data
  const wrecked = code.slice();
  for (let i = 0; i < 40; i++) wrecked[i] = (i * 211) & 0xff;
  check('RS reports failure instead of guessing when past its limit', rsDecode(wrecked, parity, []) === null);

  check('CRC-16/CCITT-FALSE matches the "123456789" check vector', crc16(new TextEncoder().encode('123456789')) === 0x29b1);
}

/* ----------------------------- end-to-end runs ---------------------------- */

interface RunResult {
  decoded: string | null;
  snrDb: number;
  corrected: number;
  erasures: number;
  syncs: number;
  seconds: number;
}

function runLink(profileId: ProfileId, text: string, sampleRate: number, channel: Partial<ChannelOptions>): RunResult {
  const params = deriveParams(PROFILES[profileId], sampleRate);
  const payload = new TextEncoder().encode(text);
  const tx = renderTransmission(payload, params, { volume: 0.9, drive: 1 });

  const rx = applyChannel(tx.samples, {
    sampleRate,
    snrDb: channel.snrDb ?? 0,
    clockPpm: channel.clockPpm,
    echoes: channel.echoes,
    gain: channel.gain,
    leadSeconds: channel.leadSeconds,
    seed: channel.seed,
  });

  const tables = buildDemodTables(params);
  const assembler = new FrameAssembler(params);

  let decoded: string | null = null;
  let snrDb = -99;
  let corrected = 0;
  let erasures = 0;
  let syncs = 0;
  let pendingReset = false;

  const core = new WWDemodCore(
    {
      sampleRate,
      fc: params.fc,
      decim: params.decim,
      N: params.N,
      sf: params.sf,
      preamble: params.preamble,
      fir: tables.fir,
      upRe: tables.upRe,
      upIm: tables.upIm,
      downRe: tables.downRe,
      downIm: tables.downIm,
      thresholdDb: 11,
      minPreamblePeaks: 3,
      maxSymbols: 700,
    },
    (msg: any) => {
      if (msg.type === 'sync') syncs++;
      if (msg.type === 'frameStart') {
        assembler.reset(msg.snrDb);
        snrDb = Math.max(snrDb, msg.snrDb);
      }
      if (msg.type === 'symbol') {
        if (decoded !== null) return;
        const out = assembler.push(msg.index, msg.value, msg.confDb);
        if (out.kind === 'decoded') {
          decoded = out.message.text;
          corrected = out.message.correctedBytes;
          erasures = out.message.erasuresUsed;
          pendingReset = true;
        } else if (out.kind === 'failed') {
          pendingReset = true;
        }
      }
    },
  );

  // Feed the stream in render quanta, mirroring how the worklet is driven, and
  // honour resets between quanta the way the main thread would.
  const quantum = 128;
  for (let i = 0; i < rx.length; i += quantum) {
    core.push(rx.subarray(i, Math.min(i + quantum, rx.length)));
    if (pendingReset) {
      pendingReset = false;
      core.reset(false);
      assembler.reset();
    }
  }

  return { decoded, snrDb, corrected, erasures, syncs, seconds: tx.seconds };
}

function testProfiles() {
  const text = 'WhisperWave 1.0 - data through the air, no networks required.';

  for (const sampleRate of [48000, 44100]) {
    console.log(`\nEnd-to-end at ${sampleRate} Hz (quiet room, mild echo, 40 ppm clock offset)`);
    for (const id of PROFILE_ORDER) {
      const r = runLink(id, text, sampleRate, {
        snrDb: 6,
        clockPpm: 40,
        echoes: [
          [11, 0.45],
          [27, 0.25],
        ],
        gain: 0.4,
        seed: 7,
      });
      const params = deriveParams(PROFILES[id], sampleRate);
      check(
        `${PROFILES[id].name.padEnd(11)} ${(params.bandLow / 1000).toFixed(1)}-${(params.bandHigh / 1000).toFixed(1)} kHz`,
        r.decoded === text,
        `air=${r.seconds.toFixed(1)}s corr=${r.corrected}B era=${r.erasures} rate=${params.bitsPerSecond.toFixed(0)}bps`,
      );
    }
  }
}

function testNoiseFloor() {
  const text = 'Range check at the edge of the room.';
  console.log('\nNoise resilience (broadband SNR, heavy multipath)');
  for (const id of PROFILE_ORDER) {
    const results: string[] = [];
    let worstOk = 99;
    for (const snrDb of [6, 0, -6, -12, -18]) {
      const r = runLink(id, text, 48000, {
        snrDb,
        clockPpm: 25,
        echoes: [
          [7, 0.6],
          [19, 0.4],
          [43, 0.3],
        ],
        gain: 0.35,
        seed: 99,
      });
      const ok = r.decoded === text;
      results.push(`${snrDb > 0 ? '+' : ''}${snrDb}dB:${ok ? 'ok' : '--'}`);
      if (ok) worstOk = Math.min(worstOk, snrDb);
    }
    check(
      `${PROFILES[id].name.padEnd(11)} decodes below the noise floor`,
      worstOk <= 0,
      `[${results.join(' ')}] best=${worstOk === 99 ? 'none' : worstOk + 'dB'}`,
    );
  }
}

function testFalsePositives() {
  console.log('\nFalse-positive guard (pure noise, no transmitter)');
  for (const id of PROFILE_ORDER) {
    const params = deriveParams(PROFILES[id], 48000);
    const tables = buildDemodTables(params);
    const assembler = new FrameAssembler(params);
    let bogus = 0;

    const core = new WWDemodCore(
      {
        sampleRate: 48000,
        fc: params.fc,
        decim: params.decim,
        N: params.N,
        sf: params.sf,
        preamble: params.preamble,
        fir: tables.fir,
        upRe: tables.upRe,
        upIm: tables.upIm,
        downRe: tables.downRe,
        downIm: tables.downIm,
        thresholdDb: 11,
        minPreamblePeaks: 3,
        maxSymbols: 700,
      },
      (msg: any) => {
        if (msg.type === 'frameStart') assembler.reset(msg.snrDb);
        if (msg.type === 'symbol') {
          const out = assembler.push(msg.index, msg.value, msg.confDb);
          if (out.kind === 'decoded') bogus++;
        }
      },
    );

    // 30 seconds of white noise plus a pink-ish rumble, per profile.
    const n = 48000 * 30;
    let seed = 4242;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    let lp = 0;
    const buf = new Float32Array(128);
    for (let i = 0; i < n; i += 128) {
      for (let k = 0; k < 128; k++) {
        const w = rand();
        lp = lp * 0.98 + w * 0.02;
        buf[k] = w * 0.25 + lp * 4;
      }
      core.push(buf);
    }
    check(`${PROFILES[id].name.padEnd(11)} printed nothing from 30 s of room noise`, bogus === 0, `frames=${bogus}`);
  }
}

function testAirtime() {
  console.log('\nAirtime estimator agrees with rendered length (within 12%)');
  for (const id of PROFILE_ORDER) {
    const params = deriveParams(PROFILES[id], 48000);
    const payload = new TextEncoder().encode('x'.repeat(48));
    const tx = renderTransmission(payload, params, { volume: 1, drive: 1 });
    const est = estimateSeconds(params, payload.length);
    const err = Math.abs(est - tx.seconds) / tx.seconds;
    check(`${PROFILES[id].name.padEnd(11)} estimate`, err < 0.12, `est=${est.toFixed(2)}s actual=${tx.seconds.toFixed(2)}s`);
  }
}

function testLongMessage() {
  console.log('\nLongest supported payload');
  const params = deriveParams(PROFILES.stealth, 48000);
  const text = 'A'.repeat(params.maxPayloadBytes);
  const r = runLink('stealth', text, 48000, { snrDb: 10, clockPpm: 0, gain: 0.5, seed: 3 });
  check(`${params.maxPayloadBytes}-byte payload survives`, r.decoded === text, `air=${r.seconds.toFixed(1)}s`);
}

function testRobustness() {
  console.log('\nArrival phase and clock offset (3 seeds each, mild echo)');
  const text = 'Robustness sweep across crystal offsets and arrival phases.';
  const echoes: Array<[number, number]> = [
    [11, 0.45],
    [27, 0.25],
  ];
  for (const id of PROFILE_ORDER) {
    let ok = 0;
    let n = 0;
    const misses: string[] = [];
    for (const sampleRate of [48000, 44100]) {
      for (const clockPpm of [0, 25, -25, 60, -60]) {
        for (const seed of [7, 21, 33]) {
          n++;
          // Nudging the lead time walks the frame across every sub-chip
          // arrival phase, which is where a receiver locked to its own
          // sampling grid quietly loses several dB.
          const leadSeconds = 0.35 + (seed % 7) * 0.00013;
          const r = runLink(id, text, sampleRate, { snrDb: 6, clockPpm, echoes, gain: 0.4, seed, leadSeconds });
          if (r.decoded === text) ok++;
          else misses.push(`${sampleRate}/${clockPpm}ppm/s${seed}`);
        }
      }
    }
    check(`${PROFILES[id].name.padEnd(11)} ${ok}/${n} conditions`, ok === n, misses.length ? `missed ${misses.join(' ')}` : '');
  }
}

testCodecs();
testProfiles();
testRobustness();
testNoiseFloor();
testFalsePositives();
testAirtime();
testLongMessage();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
