/**
 * Emitter tracking and classification.
 *
 * A single FFT frame only says "there is energy at 18.4 kHz". What a scanner
 * has to answer is "what *is* that, and has it been there long" - which needs
 * the history of a peak, not the peak. Detections are therefore associated
 * frame to frame into tracks, and the track's shape over time (drift, duty
 * cycle, harmonic relationships, width) is what gets classified.
 *
 * Pure and clock-injected: every entry point takes `now`, so the node tests
 * can run a whole minute of scanning in a millisecond.
 */

import { describeBand, type BandInfo, type Detection } from './spectrumScan';

export type EmitterKind = 'whisperwave' | 'chirp' | 'pulsed' | 'harmonic' | 'broadband' | 'carrier';

export interface ProfileBand {
  id: string;
  name: string;
  low: number;
  high: number;
}

export interface EmitterTrack {
  id: string;
  /** Smoothed centre frequency, Hz. */
  freq: number;
  bandwidth: number;
  snrDb: number;
  peakSnrDb: number;
  levelDb: number;
  firstSeen: number;
  lastSeen: number;
  /** Frames this track broke squelch in, decayed - so it reflects recent behaviour. */
  hits: number;
  frames: number;
  dutyCycle: number;
  driftHzPerSec: number;
  harmonicOf: number | null;
  /** Set when the track sits inside one of the WhisperWave profile bands. */
  profileId: string | null;
  kind: EmitterKind;
  band: BandInfo;
  label: string;
  detail: string;
  /** False once the emitter has gone quiet but before the track is pruned. */
  present: boolean;
  history: Array<{ t: number; f: number }>;
}

export interface TrackerOptions {
  /** Drop a track that has not been seen for this long. */
  holdMs?: number;
  /** Frequency window for associating a detection with an existing track. */
  gateHz?: number;
  maxTracks?: number;
  profileBands?: ProfileBand[];
}

const HISTORY = 48;

export class EmitterTracker {
  private tracks: EmitterTrack[] = [];
  private carrierBands = new Set<string>();
  private seq = 0;
  private opts: Required<Omit<TrackerOptions, 'profileBands'>> & { profileBands: ProfileBand[] };

  constructor(opts: TrackerOptions = {}) {
    this.opts = {
      holdMs: opts.holdMs ?? 2200,
      gateHz: opts.gateHz ?? 30,
      maxTracks: opts.maxTracks ?? 32,
      profileBands: opts.profileBands ?? [],
    };
  }

  setProfileBands(bands: ProfileBand[]) {
    this.opts.profileBands = bands;
  }

  /**
   * Profile bands currently carrying a transmission, decided by band occupancy
   * rather than by any single peak. A chirp fragments into a dozen narrow
   * spikes in the FFT, so without this every transmission would be listed as a
   * crowd of unrelated whistles.
   */
  setCarrierBands(ids: Set<string>) {
    this.carrierBands = ids;
  }

  reset() {
    this.tracks = [];
  }

  get all(): EmitterTrack[] {
    return this.tracks;
  }

  update(detections: Detection[], now: number): EmitterTrack[] {
    for (const t of this.tracks) {
      t.frames = t.frames * 0.97 + 1;
      t.hits *= 0.97;
      t.present = false;
    }

    // Strongest detections claim their track first, so a weak sideband cannot
    // steal the association from the carrier that spawned it.
    for (const det of detections) {
      let best: EmitterTrack | null = null;
      let bestDelta = Infinity;
      for (const t of this.tracks) {
        if (t.present) continue;
        // Association runs against where the track is *predicted* to be. A
        // siren moving 700 Hz/s crosses a fixed gate between two frames, and
        // without prediction it would spawn a fresh track every frame and
        // never look like a sweep at all. Young tracks have no velocity
        // estimate yet, so they get a wider gate for their first frames.
        const dt = Math.min(0.5, Math.max(0, (now - t.lastSeen) / 1000));
        const young = t.history.length < 3;
        const predicted = young ? t.freq : t.freq + t.driftHzPerSec * dt;
        const gate = Math.max(
          this.opts.gateHz * (young ? 3 : 1),
          det.bandwidth * 0.6,
          Math.abs(t.driftHzPerSec) * dt * 1.6,
        );
        const d = Math.abs(predicted - det.freq);
        if (d < gate && d < bestDelta) {
          best = t;
          bestDelta = d;
        }
      }
      if (best) this.merge(best, det, now);
      else if (this.tracks.length < this.opts.maxTracks) this.tracks.push(this.spawn(det, now));
    }

    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.opts.holdMs);
    for (const t of this.tracks) {
      t.dutyCycle = t.frames > 0 ? Math.min(1, t.hits / t.frames) : 0;
      t.driftHzPerSec = driftOf(t.history);
    }
    this.markHarmonics();
    for (const t of this.tracks) this.classify(t);

    this.tracks.sort((a, b) => b.snrDb - a.snrDb);
    return this.tracks;
  }

  private spawn(det: Detection, now: number): EmitterTrack {
    const t: EmitterTrack = {
      id: `em-${++this.seq}`,
      freq: det.freq,
      bandwidth: det.bandwidth,
      snrDb: det.snrDb,
      peakSnrDb: det.snrDb,
      levelDb: det.levelDb,
      firstSeen: now,
      lastSeen: now,
      hits: 1,
      frames: 1,
      dutyCycle: 1,
      driftHzPerSec: 0,
      harmonicOf: null,
      profileId: null,
      kind: 'carrier',
      band: describeBand(det.freq),
      label: '',
      detail: '',
      present: true,
      history: [{ t: now, f: det.freq }],
    };
    this.classify(t);
    return t;
  }

  private merge(t: EmitterTrack, det: Detection, now: number) {
    // A chirp genuinely moves, so the centre follows the detection fairly
    // quickly; level and width are noisier and get smoothed harder.
    t.freq = t.freq * 0.55 + det.freq * 0.45;
    t.bandwidth = t.bandwidth * 0.7 + det.bandwidth * 0.3;
    t.snrDb = t.snrDb * 0.6 + det.snrDb * 0.4;
    t.levelDb = t.levelDb * 0.6 + det.levelDb * 0.4;
    t.peakSnrDb = Math.max(t.peakSnrDb, det.snrDb);
    t.lastSeen = now;
    t.hits += 1;
    t.present = true;
    t.band = describeBand(t.freq);
    t.history.push({ t: now, f: det.freq });
    if (t.history.length > HISTORY) t.history.shift();
  }

  /**
   * Flag every track that sits at an integer multiple of a stronger, lower
   * one. Rooms are full of harmonic stacks - mains hum, motors, a struck
   * note - and listing eight of them as eight independent emitters is noise,
   * not information.
   */
  private markHarmonics() {
    for (const t of this.tracks) {
      t.harmonicOf = null;
      for (const base of this.tracks) {
        if (base === t || base.freq >= t.freq - 1 || base.snrDb < t.snrDb) continue;
        const ratio = t.freq / base.freq;
        const n = Math.round(ratio);
        if (n < 2 || n > 12) continue;
        if (Math.abs(t.freq - n * base.freq) <= Math.max(6, base.freq * 0.02)) {
          t.harmonicOf = Math.round(base.freq);
          break;
        }
      }
    }
  }

  private classify(t: EmitterTrack) {
    const profile = this.opts.profileBands.find((b) => t.freq >= b.low && t.freq <= b.high) ?? null;
    t.profileId = profile?.id ?? null;

    const drift = Math.abs(t.driftHzPerSec);
    const wide = t.bandwidth > 420;
    const settled = t.frames > 6;

    // Membership of a live carrier band comes from band occupancy, measured
    // over the whole band; a lone tone that happens to drift inside the band
    // is a whistle, not a transmission, and must not claim the receiver.
    if (profile && (this.carrierBands.has(profile.id) || t.bandwidth > (profile.high - profile.low) * 0.25)) {
      t.kind = 'whisperwave';
      t.label = 'WhisperWave carrier';
      t.detail = `Spread energy across the ${profile.name} band - tune the receiver to decode it.`;
      return;
    }
    if (drift > 220 && t.history.length > 4) {
      t.kind = 'chirp';
      t.label = 'Sweeping emitter';
      const dir = t.driftHzPerSec > 0 ? 'rising' : 'falling';
      t.detail = `${dir} at ${Math.round(drift)} Hz/s - a sweep, siren or ramping mechanical source.`;
      return;
    }
    if (t.harmonicOf !== null) {
      t.kind = 'harmonic';
      t.label = `Harmonic of ${fmtHz(t.harmonicOf)}`;
      t.detail = `Overtone of a ${fmtHz(t.harmonicOf)} source - mains hum, a motor or a musical note.`;
      return;
    }
    // A track has to have been around long enough for "sometimes present" to
    // mean anything; two flickering frames of noise is not a beacon.
    if (settled && t.hits >= 3 && t.dutyCycle < 0.6) {
      t.kind = 'pulsed';
      t.label = 'Pulsed beacon';
      t.detail = `Present ${Math.round(t.dutyCycle * 100)}% of the time - beeps, alarms or a duty-cycled beacon.`;
      return;
    }
    if (wide) {
      t.kind = 'broadband';
      t.label = 'Broadband noise';
      t.detail = `${fmtHz(t.bandwidth)} wide - fan, water, traffic or crowd noise rather than a single source.`;
      return;
    }
    t.kind = 'carrier';
    t.label = 'Steady carrier';
    t.detail = `Narrowband tone holding ${fmtHz(t.freq)}. ${t.band.note}`;
  }
}

/** Least-squares slope of frequency against time, in Hz per second. */
export function driftOf(history: Array<{ t: number; f: number }>): number {
  if (history.length < 3) return 0;
  const n = history.length;
  const t0 = history[0].t;
  let st = 0;
  let sf = 0;
  let stt = 0;
  let stf = 0;
  for (const h of history) {
    const x = (h.t - t0) / 1000;
    st += x;
    sf += h.f;
    stt += x * x;
    stf += x * h.f;
  }
  const denom = n * stt - st * st;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * stf - st * sf) / denom;
}

export function fmtHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 2 : 3)} kHz` : `${Math.round(hz)} Hz`;
}
