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
import { detectCarrier, detectPeaks, estimateNoiseFloor, summarize, sweepChannels, describeBand } from '../src/dsp/spectrumScan';
import { EmitterTracker, driftOf, type ProfileBand } from '../src/dsp/emitters';
import { detectLanguage } from '../src/i18n/detect';

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


/* --------------------------- spectrum scanner ---------------------------- */

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tone {
  f: number;
  db: number;
  /** Gaussian half-width in bins. */
  width?: number;
}

/**
 * Build a synthetic dB spectrum: a (optionally tilted) noise bed with ripple,
 * plus gaussian-shaped tones summed in linear power.
 */
function synthSpectrum(bins: number, binHz: number, tones: Tone[], opts: { noiseDb?: number; tiltDb?: number; seed?: number } = {}) {
  const noiseDb = opts.noiseDb ?? -108;
  const tilt = opts.tiltDb ?? 0;
  const rand = prng(opts.seed ?? 7);
  const lin = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    const db = noiseDb + (tilt * i) / bins + (rand() * 2 - 1) * 2.5;
    lin[i] = 10 ** (db / 10);
  }
  for (const t of tones) {
    const centre = t.f / binHz;
    const width = t.width ?? 1.1;
    const lo = Math.max(0, Math.floor(centre - width * 6));
    const hi = Math.min(bins - 1, Math.ceil(centre + width * 6));
    for (let i = lo; i <= hi; i++) {
      const d = (i - centre) / width;
      lin[i] += 10 ** (t.db / 10) * Math.exp(-0.5 * d * d);
    }
  }
  const spec = new Float32Array(bins);
  for (let i = 0; i < bins; i++) spec[i] = 10 * Math.log10(lin[i]);
  return spec;
}

function settleFloor(spec: Float32Array, frames = 40) {
  const floor = new Float32Array(spec.length);
  floor.fill(-150);
  for (let i = 0; i < frames; i++) estimateNoiseFloor(spec, floor, { blockSize: 64, percentile: 0.3, alpha: 0.25 });
  return floor;
}

function testSpectrumScan() {
  console.log('\nSpectrum scanner');

  const BINS = 4096;
  const BIN_HZ = 24000 / BINS;

  // A tone must not be allowed to lift the floor around it, or a scanner
  // slowly goes blind to exactly the signals it is looking for.
  const withTone = synthSpectrum(BINS, BIN_HZ, [{ f: 18400, db: -55 }], { noiseDb: -108 });
  const floorTone = settleFloor(withTone);
  const atTone = floorTone[Math.round(18400 / BIN_HZ)];
  check('Floor ignores a 50 dB carrier sitting on it', Math.abs(atTone + 108) < 4, `floor ${atTone.toFixed(1)} dB`);

  // A sloped noise bed - phone mics roll off badly at both ends - has to be
  // followed, or one end of the span detects everything and the other nothing.
  const tilted = synthSpectrum(BINS, BIN_HZ, [], { noiseDb: -120, tiltDb: 30 });
  const floorTilt = settleFloor(tilted);
  const lowEnd = floorTilt[100];
  const highEnd = floorTilt[BINS - 100];
  check('Floor follows a 30 dB tilt across the span', highEnd - lowEnd > 22 && highEnd - lowEnd < 38, `${(highEnd - lowEnd).toFixed(1)} dB rise`);

  // Detection accuracy on planted tones.
  const planted = [1000, 4500, 12000, 19000];
  // The 4.5 kHz tone is deliberately the loudest, so the summary has an
  // unambiguous winner to report.
  const spec = synthSpectrum(BINS, BIN_HZ, planted.map((f) => ({ f, db: f === 4500 ? -66 : -78 })), { noiseDb: -108 });
  const floor = settleFloor(spec);
  const peaks = detectPeaks(spec, floor, { binHz: BIN_HZ, squelchDb: 9 });
  const found = planted.filter((f) => peaks.some((p) => Math.abs(p.freq - f) < BIN_HZ * 1.5));
  check(`Finds all ${planted.length} planted tones`, found.length === planted.length, `found ${found.length}, ${peaks.length} peaks total`);

  const worst = Math.max(...planted.map((f) => {
    const p = peaks.reduce((best, q) => (Math.abs(q.freq - f) < Math.abs(best.freq - f) ? q : best), peaks[0]);
    return Math.abs(p.freq - f);
  }));
  check('Interpolated centres land inside half a bin', worst < BIN_HZ * 0.5, `worst ${worst.toFixed(2)} Hz (bin ${BIN_HZ.toFixed(2)} Hz)`);

  // Squelch has to actually gate.
  const faint = synthSpectrum(BINS, BIN_HZ, [{ f: 9000, db: -101 }], { noiseDb: -108, seed: 11 });
  const faintFloor = settleFloor(faint);
  const gated = detectPeaks(faint, faintFloor, { binHz: BIN_HZ, squelchDb: 14 });
  const open = detectPeaks(faint, faintFloor, { binHz: BIN_HZ, squelchDb: 4 });
  check('Squelch rejects a 7 dB peak at 14 dB and passes it at 4 dB',
    !gated.some((p) => Math.abs(p.freq - 9000) < 40) && open.some((p) => Math.abs(p.freq - 9000) < 40),
    `${gated.length} vs ${open.length} detections`);

  // False alarms on pure noise, across several seeds.
  let alarms = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const noise = synthSpectrum(BINS, BIN_HZ, [], { noiseDb: -108, seed });
    alarms += detectPeaks(noise, settleFloor(noise), { binHz: BIN_HZ, squelchDb: 9 }).length;
  }
  check('No false alarms on pure noise over 12 frames', alarms === 0, `${alarms} spurious detections`);

  const sum = summarize(spec, floor, BIN_HZ, 9);
  check('Occupancy of four narrow tones stays under 1%', sum.occupancy < 0.01, `${(sum.occupancy * 100).toFixed(2)}%`);
  check('Summary reports the loudest emitter', Math.abs(sum.peakFreq - 4500) < BIN_HZ * 2, `${sum.peakFreq.toFixed(0)} Hz`);

  // A spread-spectrum carrier is far wider than one floor-estimation block.
  // Estimating the floor locally only would let the plateau become its own
  // floor and vanish - which is how the scanner would go blind to exactly the
  // signal this app transmits.
  const plateauTones: Tone[] = [];
  for (let f = 17200; f <= 19600; f += 20) plateauTones.push({ f, db: -92, width: 2 });
  const wide = synthSpectrum(BINS, BIN_HZ, plateauTones, { noiseDb: -108, seed: 5 });
  const wideFloor = settleFloor(wide);
  const widePeaks = detectPeaks(wide, wideFloor, { binHz: BIN_HZ, squelchDb: 9 });
  const spread = widePeaks.find((p) => p.freq > 17000 && p.freq < 19800);
  check('A 2.4 kHz spread carrier survives the floor estimator',
    Boolean(spread) && spread!.bandwidth > 1200,
    spread ? `${spread.bandwidth.toFixed(0)} Hz wide, +${spread.snrDb.toFixed(0)} dB` : 'not detected');

  /* Carrier detection: what makes the scanner hand a band to the receiver. */
  const STEALTH = { low: 17200, high: 19600 };

  // A real transmission ripples rather than sitting flat, and it fragments
  // into many narrow peaks - which is exactly what a browser FFT shows for a
  // chirp, and why the verdict is made on band occupancy rather than on peaks.
  const rippleTones: Tone[] = [];
  for (let f = 17250; f <= 19550; f += 60) rippleTones.push({ f, db: -88 + (f % 180) / 12, width: 1.2 });
  const carrierSpec = synthSpectrum(BINS, BIN_HZ, rippleTones, { noiseDb: -108, seed: 3 });
  const carrierFloor = settleFloor(carrierSpec);
  const verdict = detectCarrier(carrierSpec, carrierFloor, BIN_HZ, 9, STEALTH, 24000);
  check('A fragmented chirp still reads as a carrier in its band',
    verdict.isCarrier,
    `occ ${(verdict.occupancy * 100).toFixed(0)}% span ${(verdict.span * 100).toFixed(0)}% contrast ${verdict.contrastDb.toFixed(1)} dB`);

  // A hand clap lights every band at once; guard-band contrast is what tells
  // the two apart, and getting this wrong would retune the receiver on noise.
  const clap = synthSpectrum(BINS, BIN_HZ, [], { noiseDb: -108, seed: 9 });
  for (let i = 0; i < clap.length; i++) clap[i] += 25;
  const clapVerdict = detectCarrier(clap, settleFloor(synthSpectrum(BINS, BIN_HZ, [], { noiseDb: -108, seed: 9 })), BIN_HZ, 9, STEALTH, 24000);
  check('Broadband noise across the whole span is not a carrier',
    !clapVerdict.isCarrier,
    `occ ${(clapVerdict.occupancy * 100).toFixed(0)}% contrast ${clapVerdict.contrastDb.toFixed(1)} dB`);

  // An audible transmission splatters weak energy outside its own band, which
  // saturates any occupancy-fraction contrast; the dB contrast is what still
  // separates it from the surroundings. This is the Long Range case.
  const splatterTones: Tone[] = [];
  for (let f = 2000; f <= 6000; f += 60) splatterTones.push({ f, db: -70, width: 1.4 });
  for (let f = 200; f <= 9000; f += 120) splatterTones.push({ f, db: -96, width: 1.4 });
  const loud = synthSpectrum(BINS, BIN_HZ, splatterTones, { noiseDb: -108, seed: 6 });
  const loudFloor = settleFloor(loud);
  const loudVerdict = detectCarrier(loud, loudFloor, BIN_HZ, 9, { low: 2000, high: 6000 }, 24000);
  check('A loud in-band carrier wins despite splatter over its guard bands',
    loudVerdict.isCarrier,
    `occ ${(loudVerdict.occupancy * 100).toFixed(0)}% guard-occ ${(loudVerdict.guardOccupancy * 100).toFixed(0)}% contrast ${loudVerdict.contrastDb.toFixed(1)} dB`);

  // One whistle inside the band is a whistle, not a transmission.
  const whistleSpec = synthSpectrum(BINS, BIN_HZ, [{ f: 18400, db: -60 }], { noiseDb: -108, seed: 4 });
  const whistleVerdict = detectCarrier(whistleSpec, settleFloor(whistleSpec), BIN_HZ, 9, STEALTH, 24000);
  check('A single tone inside the band is not a carrier',
    !whistleVerdict.isCarrier,
    `occ ${(whistleVerdict.occupancy * 100).toFixed(1)}% span ${(whistleVerdict.span * 100).toFixed(0)}%`);

  // Silence must not.
  const quiet = synthSpectrum(BINS, BIN_HZ, [], { noiseDb: -108, seed: 21 });
  check('Silence is not a carrier', !detectCarrier(quiet, settleFloor(quiet), BIN_HZ, 9, STEALTH, 24000).isCarrier);

  // Band lexicon and sweep channels.
  check('19 kHz is named as near-ultrasonic', describeBand(19000).name === 'Near-ultrasonic', describeBand(19000).name);
  check('60 Hz is named as mains hum', describeBand(60).name === 'Mains hum', describeBand(60).name);
  const channels = sweepChannels(24000);
  check('Sweep channels tile the span without exceeding Nyquist',
    channels.length >= 8 && channels[channels.length - 1].high <= 24000,
    `${channels.length} channels, top ${channels[channels.length - 1].high} Hz`);
}

/* ------------------------------- emitters -------------------------------- */

const PROFILE_TEST_BANDS: ProfileBand[] = [
  { id: 'stealth', name: 'Stealth', low: 17200, high: 19600 },
  { id: 'longrange', name: 'Long Range', low: 2000, high: 6000 },
];

function det(freq: number, snrDb = 20, bandwidth = 12) {
  return { freq, lowFreq: freq - bandwidth / 2, highFreq: freq + bandwidth / 2, bandwidth, levelDb: -70, snrDb };
}

function testEmitters() {
  console.log('\nEmitter tracking');

  check('Drift regression recovers a known slope', Math.abs(driftOf([
    { t: 0, f: 1000 }, { t: 500, f: 1250 }, { t: 1000, f: 1500 }, { t: 1500, f: 1750 },
  ]) - 500) < 1e-6);

  // A steady tone is one track, not one per frame.
  const steady = new EmitterTracker({ profileBands: PROFILE_TEST_BANDS });
  let t = 0;
  for (let i = 0; i < 40; i++, t += 55) steady.update([det(9000 + Math.sin(i) * 2)], t);
  const steadyTracks = steady.update([det(9000)], t);
  check('A held tone stays one track over 40 frames', steadyTracks.length === 1, `${steadyTracks.length} tracks`);
  check('Held tone classifies as a steady carrier', steadyTracks[0].kind === 'carrier', steadyTracks[0].kind);
  check('Held tone reports full duty cycle', steadyTracks[0].dutyCycle > 0.95, steadyTracks[0].dutyCycle.toFixed(2));

  // Beeping beacon: two frames on, three off.
  const pulsed = new EmitterTracker();
  t = 0;
  for (let i = 0; i < 60; i++, t += 55) pulsed.update(i % 5 < 2 ? [det(3500)] : [], t);
  const pulsedTrack = pulsed.update([det(3500)], t)[0];
  check('Duty-cycled beacon is classified as pulsed', pulsedTrack?.kind === 'pulsed', `${pulsedTrack?.kind} duty ${pulsedTrack?.dutyCycle.toFixed(2)}`);

  // A sweep.
  const chirp = new EmitterTracker();
  t = 0;
  for (let i = 0; i < 25; i++, t += 55) chirp.update([det(1000 + i * 40)], t);
  const chirpTrack = chirp.update([det(1000 + 25 * 40)], t)[0];
  check('A sweeping tone is classified as a chirp', chirpTrack?.kind === 'chirp', `${chirpTrack?.kind} drift ${chirpTrack?.driftHzPerSec.toFixed(0)} Hz/s`);
  check('Sweep drift is measured within 15%', Math.abs(chirpTrack.driftHzPerSec - 727) / 727 < 0.15, `${chirpTrack.driftHzPerSec.toFixed(0)} Hz/s vs 727`);

  // Harmonic stack: 50 Hz mains and its overtones.
  const hum = new EmitterTracker();
  t = 0;
  const stack = [det(50, 30), det(100, 24), det(150, 20), det(200, 16)];
  for (let i = 0; i < 20; i++, t += 55) hum.update(stack, t);
  const humTracks = hum.update(stack, t);
  const harmonics = humTracks.filter((x) => x.kind === 'harmonic');
  check('Mains overtones are folded into harmonics of 50 Hz',
    harmonics.length === 3 && harmonics.every((x) => x.harmonicOf === 50),
    `${harmonics.length} of ${humTracks.length} marked`);

  // A spread carrier inside a profile band is the auto-lock trigger.
  const wave = new EmitterTracker({ profileBands: PROFILE_TEST_BANDS });
  t = 0;
  for (let i = 0; i < 15; i++, t += 55) wave.update([det(18400, 18, 1800)], t);
  const waveTrack = wave.update([det(18400, 18, 1800)], t)[0];
  check('Spread energy in a profile band reads as a WhisperWave carrier',
    waveTrack?.kind === 'whisperwave' && waveTrack.profileId === 'stealth',
    `${waveTrack?.kind} / ${waveTrack?.profileId}`);

  // A narrow whistle inside the same band must not trigger it.
  const whistle = new EmitterTracker({ profileBands: PROFILE_TEST_BANDS });
  t = 0;
  for (let i = 0; i < 15; i++, t += 55) whistle.update([det(18400, 18, 10)], t);
  const whistleTrack = whistle.update([det(18400, 18, 10)], t)[0];
  check('A narrow tone in the same band does not trigger auto-lock', whistleTrack?.kind !== 'whisperwave', whistleTrack?.kind);

  // Tracks expire once the emitter stops.
  const gone = new EmitterTracker({ holdMs: 500 });
  t = 0;
  for (let i = 0; i < 10; i++, t += 55) gone.update([det(7000)], t);
  const after = gone.update([], t + 900);
  check('Tracks are pruned after the hold time', after.length === 0, `${after.length} left`);
}

/* -------------------------- language identification ---------------------- */

function testLanguageDetection() {
  console.log('\nLanguage identification');

  const samples: Array<[string, string, string]> = [
    ['en', 'The transmitter is on the table and the receiver is not working', 'English'],
    ['hi', 'यह संदेश ध्वनि के माध्यम से भेजा गया है और यह काम कर रहा है', 'Hindi'],
    ['mr', 'हा संदेश आवाजाच्या माध्यमातून पाठवला आहे आणि तो काम करत आहे', 'Marathi'],
    ['ru', 'Это сообщение отправлено через звук и оно работает', 'Russian'],
    ['uk', 'Це повідомлення надіслано звуком та воно працює', 'Ukrainian'],
    ['ar', 'هذا الرسالة أرسلت من خلال الصوت إلى الجهاز', 'Arabic'],
    ['ja', 'このメッセージは音で送信されました', 'Japanese'],
    ['zh', '这条消息是通过声音发送的', 'Chinese'],
    ['ko', '이 메시지는 소리로 전송되었습니다', 'Korean'],
    ['ta', 'இந்த செய்தி ஒலி மூலம் அனுப்பப்பட்டது', 'Tamil'],
    ['el', 'Αυτό το μήνυμα στάλθηκε μέσω ήχου', 'Greek'],
    ['he', 'ההודעה הזאת נשלחה באמצעות צליל', 'Hebrew'],
    ['th', 'ข้อความนี้ถูกส่งผ่านเสียง', 'Thai'],
    ['es', 'El mensaje fue enviado por el sonido y no está en la red', 'Spanish'],
    ['fr', 'Le message est envoyé par le son et il ne passe pas dans le réseau', 'French'],
    ['de', 'Die Nachricht ist mit dem Ton gesendet und nicht mit dem Netz', 'German'],
    ['pt', 'A mensagem não foi enviada com uma rede, mas com som', 'Portuguese'],
    ['tr', 'Bu mesaj ses ile gönderildi ve bir ağ değil', 'Turkish'],
    ['id', 'Pesan ini dikirim dengan suara dan tidak dengan jaringan', 'Indonesian'],
    ['vi', 'Tin nhắn này được gửi bằng âm thanh và không có mạng', 'Vietnamese'],
  ];

  let hit = 0;
  const misses: string[] = [];
  for (const [expected, text, label] of samples) {
    const guess = detectLanguage(text);
    if (guess.code === expected) hit++;
    else misses.push(`${label}->${guess.code}`);
  }
  check(`Identifies ${hit}/${samples.length} languages from script and markers`, hit === samples.length, misses.join(' '));

  check('Empty text is undetermined', detectLanguage('   ').code === 'und');
  check('Digits alone are undetermined', detectLanguage('12345 6789').code === 'und');
  check('Confidence is capped on very short strings', detectLanguage('si').confidence < 0.7, detectLanguage('si').confidence.toFixed(2));
  check('A long clean sample is confident', detectLanguage(samples[1][1]).confidence > 0.6, detectLanguage(samples[1][1]).confidence.toFixed(2));
}

testCodecs();
testProfiles();
testSpectrumScan();
testEmitters();
testLanguageDetection();
testRobustness();
testNoiseFloor();
testFalsePositives();
testAirtime();
testLongMessage();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
