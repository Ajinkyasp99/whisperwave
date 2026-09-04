/**
 * Ambient spectrum scanner.
 *
 * Owns a high-resolution AnalyserNode over the raw microphone and turns it
 * into a live picture of everything audible around the device: what is
 * occupying which band, how long it has been there, and whether any of it is
 * a WhisperWave carrier worth decoding.
 *
 * Framework-free on purpose, like the rest of `audio/` - React subscribes to
 * throttled frames, while the canvas reads the raw arrays every animation
 * frame without pushing anything through the store.
 */

import { EmitterTracker, type EmitterTrack, type ProfileBand } from '../dsp/emitters';
import {
  detectCarrier,
  detectPeaks,
  estimateNoiseFloor,
  summarize,
  sweepChannels,
  type BandInfo,
  type ScanSummary,
} from '../dsp/spectrumScan';

export type ScanMode = 'wide' | 'sweep' | 'hold';

export interface CarrierHit {
  profileId: string;
  profileName: string;
  freq: number;
  snrDb: number;
  /** Fraction of the band's bins that are lit up. */
  occupancy: number;
  /** How much stronger the band is than the spectrum either side of it, in dB. */
  contrastDb: number;
  /** How long the carrier has been continuously present, in ms. */
  heldMs: number;
}

export interface ScanFrame {
  at: number;
  sampleRate: number;
  binHz: number;
  summary: ScanSummary;
  tracks: EmitterTrack[];
  mode: ScanMode;
  channel: BandInfo | null;
  channelIndex: number;
  channels: BandInfo[];
  /** True while the sweep is parked on a channel because the squelch broke. */
  holding: boolean;
  carrier: CarrierHit | null;
}

/** Analysis rate. 8192-point FFTs sixty times a second is wasted work. */
const ANALYSIS_MS = 55;
/** How often React hears about it. */
const EMIT_MS = 160;
/** Base dwell per sweep channel. */
const DWELL_MS = 2600;
/** Extra dwell granted while something is breaking squelch in this channel. */
const HOLD_MS = 4000;

export class SpectrumScanner {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private spec: Float32Array<ArrayBuffer> | null = null;
  private floor: Float32Array<ArrayBuffer> | null = null;

  private tracker = new EmitterTracker();
  private profileBands: ProfileBand[] = [];
  private squelchDb = 9;
  private mode: ScanMode = 'wide';
  private channelIndex = 0;
  private channels: BandInfo[] = [];
  private channelSince = 0;
  private holding = false;

  private viewLo = 0;
  private viewHi = 24000;
  private targetLo = 0;
  private targetHi = 24000;

  private carrierSince = new Map<string, number>();
  private carrier: CarrierHit | null = null;
  private lastSummary: ScanSummary | null = null;

  private rafId = 0;
  private running = false;
  private lastAnalysis = 0;
  private lastEmit = 0;
  private callbacks: Array<(f: ScanFrame) => void> = [];

  /* ------------------------------ lifecycle ----------------------------- */

  attach(ctx: AudioContext, source: AudioNode) {
    this.detach();
    this.ctx = ctx;

    const analyser = ctx.createAnalyser();
    // 8192 points is ~5.9 Hz per bin at 48 kHz: fine enough to separate a
    // 50 Hz hum from its 100 Hz harmonic, coarse enough to stay real-time.
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -150;
    analyser.maxDecibels = -5;
    source.connect(analyser);

    this.analyser = analyser;
    this.spec = new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4));
    this.floor = new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * 4));
    this.floor.fill(-150);

    const nyquist = ctx.sampleRate / 2;
    this.channels = sweepChannels(nyquist);
    this.channelIndex = 0;
    this.channelSince = now();
    this.viewLo = this.targetLo = 0;
    this.viewHi = this.targetHi = nyquist;
    this.tracker.reset();
    this.carrierSince.clear();
    this.carrier = null;

    this.start();
  }

  detach() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.analyser = null;
    this.spec = null;
    this.floor = null;
    this.ctx = null;
    this.tracker.reset();
    this.carrier = null;
    this.lastSummary = null;
  }

  get active(): boolean {
    return this.running && this.analyser !== null;
  }

  onFrame(cb: (f: ScanFrame) => void): () => void {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  /* ------------------------------- controls ----------------------------- */

  setSquelchDb(db: number) {
    this.squelchDb = db;
  }

  setProfileBands(bands: ProfileBand[]) {
    this.profileBands = bands;
    this.tracker.setProfileBands(bands);
  }

  setMode(mode: ScanMode) {
    this.mode = mode;
    this.channelSince = now();
    if (mode === 'wide') {
      this.targetLo = 0;
      this.targetHi = this.nyquist;
    } else {
      this.applyChannelView();
    }
  }

  /** Park the sweep on one channel (also used by the tap-to-zoom scope). */
  selectChannel(index: number) {
    if (!this.channels.length) return;
    this.channelIndex = ((index % this.channels.length) + this.channels.length) % this.channels.length;
    this.channelSince = now();
    this.mode = 'hold';
    this.applyChannelView();
  }

  /* -------------------------- reads for the canvas ---------------------- */

  get spectrumDb(): Float32Array | null {
    return this.spec;
  }
  get floorDb(): Float32Array | null {
    return this.floor;
  }
  get binHz(): number {
    return this.ctx && this.spec ? this.ctx.sampleRate / 2 / this.spec.length : 0;
  }
  get nyquist(): number {
    return this.ctx ? this.ctx.sampleRate / 2 : 24000;
  }
  get view(): { lo: number; hi: number } {
    return { lo: this.viewLo, hi: this.viewHi };
  }
  get squelch(): number {
    return this.squelchDb;
  }
  get tracks(): EmitterTrack[] {
    return this.tracker.all;
  }
  get channelList(): BandInfo[] {
    return this.channels;
  }
  get currentChannel(): BandInfo | null {
    return this.channels[this.channelIndex] ?? null;
  }
  get summary(): ScanSummary | null {
    return this.lastSummary;
  }

  /* -------------------------------- loop -------------------------------- */

  private start() {
    if (this.running) return;
    this.running = true;
    this.lastAnalysis = 0;
    this.lastEmit = 0;

    const tick = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const t = now();

      const analyser = this.analyser;
      const spec = this.spec;
      const floor = this.floor;
      if (!analyser || !spec || !floor) return;

      // The canvas wants a fresh trace every frame; detection does not.
      analyser.getFloatFrequencyData(spec);
      this.easeView();

      if (t - this.lastAnalysis < ANALYSIS_MS) return;
      this.lastAnalysis = t;

      estimateNoiseFloor(spec, floor, { blockSize: 64, percentile: 0.3, alpha: 0.2 });
      const binHz = this.binHz;
      const detections = detectPeaks(spec, floor, {
        binHz,
        squelchDb: this.squelchDb,
        minFreq: 30,
        maxFreq: this.nyquist * 0.98,
        maxPeaks: 28,
      });
      // Carrier detection runs before tracking so the tracker knows which
      // bands are live and can label their fragments as one transmission.
      this.updateCarrier(t);
      const tracks = this.tracker.update(detections, t);
      this.lastSummary = summarize(spec, floor, binHz, this.squelchDb);
      this.advanceSweep(tracks, t);

      if (t - this.lastEmit >= EMIT_MS) {
        this.lastEmit = t;
        this.emit(t);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Decide which profile bands are carrying a transmission, and for how long.
   *
   * Auto-lock keys off the dwell rather than a single frame, because one loud
   * key jangle in the ultrasonic band should not retune the receiver.
   */
  private updateCarrier(t: number) {
    const spec = this.spec;
    const floor = this.floor;
    if (!spec || !floor) return;

    const binHz = this.binHz;
    const live = new Set<string>();
    let best: CarrierHit | null = null;

    for (const band of this.profileBands) {
      const verdict = detectCarrier(spec, floor, binHz, this.squelchDb, band, this.nyquist);
      if (!verdict.isCarrier) continue;
      live.add(band.id);
      const since = this.carrierSince.get(band.id) ?? t;
      this.carrierSince.set(band.id, since);
      const hit: CarrierHit = {
        profileId: band.id,
        profileName: band.name,
        freq: verdict.peakFreq,
        snrDb: verdict.peakExcessDb,
        occupancy: verdict.occupancy,
        contrastDb: verdict.contrastDb,
        heldMs: t - since,
      };
      // Profile bands overlap - a Stealth transmission lights part of the
      // Ghost band too - so the winner is the band whose *edges* the energy
      // stops at, which is what guard-band contrast measures. Occupancy alone
      // would always hand it to the narrowest overlapping band.
      if (!best || hit.contrastDb > best.contrastDb) best = hit;
    }

    for (const id of Array.from(this.carrierSince.keys())) {
      if (!live.has(id)) this.carrierSince.delete(id);
    }
    this.tracker.setCarrierBands(live);
    this.carrier = best;
  }

  private advanceSweep(tracks: EmitterTrack[], t: number) {
    if (this.mode !== 'sweep' || this.channels.length === 0) {
      if (this.mode !== 'sweep') this.holding = false;
      return;
    }
    const ch = this.channels[this.channelIndex];
    const busy = tracks.some((tr) => tr.present && tr.freq >= ch.low && tr.freq < ch.high && tr.snrDb > this.squelchDb + 2);
    this.holding = busy;

    const elapsed = t - this.channelSince;
    const limit = busy ? DWELL_MS + HOLD_MS : DWELL_MS;
    if (elapsed >= limit) {
      this.channelIndex = (this.channelIndex + 1) % this.channels.length;
      this.channelSince = t;
      this.applyChannelView();
    }
  }

  private applyChannelView() {
    const ch = this.channels[this.channelIndex];
    if (!ch) return;
    const pad = Math.max(120, (ch.high - ch.low) * 0.12);
    this.targetLo = Math.max(0, ch.low - pad);
    this.targetHi = Math.min(this.nyquist, ch.high + pad);
  }

  /** Zooming instantly between bands makes the waterfall unreadable. */
  private easeView() {
    const k = 0.12;
    this.viewLo += (this.targetLo - this.viewLo) * k;
    this.viewHi += (this.targetHi - this.viewHi) * k;
    if (Math.abs(this.targetLo - this.viewLo) < 1) this.viewLo = this.targetLo;
    if (Math.abs(this.targetHi - this.viewHi) < 1) this.viewHi = this.targetHi;
  }

  private emit(t: number) {
    if (!this.lastSummary) return;
    const frame: ScanFrame = {
      at: t,
      sampleRate: this.ctx?.sampleRate ?? 48000,
      binHz: this.binHz,
      summary: this.lastSummary,
      // Snapshot: the tracker mutates its own objects in place every frame.
      tracks: this.tracker.all.map((tr) => ({ ...tr, history: [] })),
      mode: this.mode,
      channel: this.currentChannel,
      channelIndex: this.channelIndex,
      channels: this.channels,
      holding: this.holding,
      carrier: this.carrier,
    };
    for (const cb of this.callbacks) cb(frame);
  }
}

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export const spectrumScanner = new SpectrumScanner();
