/* eslint-disable */
/**
 * WhisperWave CSS demodulator - AudioWorklet physical layer.
 *
 * Chain, per input sample:
 *   mix down by fc  ->  decimating low-pass  ->  complex baseband at bw Hz
 *
 * and per baseband sample:
 *   matched filter vs. the up-chirp (and, once armed, the down-chirp)
 *   -> preamble / SFD detection -> de-chirp + FFT -> one symbol index
 *
 * Only the physical layer lives here. Symbol indices and their confidences are
 * posted to the main thread, which owns Gray decoding, Reed-Solomon and CRC.
 * Keeping the link layer out of the audio thread means a slow decode can never
 * cause a buffer underrun.
 *
 * This file is served verbatim from /public - no bundler transform - so it must
 * stay dependency-free. `WWDemodCore` is also exposed on globalThis so the same
 * code can be exercised head-less in tests.
 */

const TWO_PI = Math.PI * 2;

/** Down-chirp correlation must reach this fraction of the preamble peak. */
const SFD_RELATIVE = 0.2;
/** Once a preamble run is under way, later peaks must be this close in level. */
const PEAK_RELATIVE = 0.06;
/** How many simultaneous propagation paths the preamble tracker follows. */
const MAX_PATHS = 6;
/**
 * Symbol-timing loop, proportional + integral.
 *
 * Multipath makes the per-symbol offset estimate jitter by a few tenths of a
 * bin, while the drift we actually chase (crystal mismatch) is around 0.005
 * bins per symbol. So the proportional term is deliberately tiny and the
 * integral term does the work: it learns the drift *rate* and feeds it forward,
 * which tracks a ramp with no standing error and ignores the jitter.
 */
const TRACK_KP = 0.15;
const TRACK_KI = 0.006;
/** Cap on the learned drift rate, in bins per symbol. */
const TRACK_MAX_RATE = 0.05;
/**
 * Hand a whole chip to the window position past this offset. Sitting well
 * beyond 0.5 gives the transfer hysteresis, so a jittery estimate near the
 * boundary cannot thrash the window back and forth.
 */
const TRACK_TRANSFER = 0.5;
/**
 * Ceiling on the reported link margin, in dB.
 *
 * The correlator's peak-to-floor ratio is unbounded when the room is silent -
 * a clean recording drives the noise estimate toward zero and the honest
 * quotient runs to a meaningless 150 dB. Anything past this is "as good as it
 * gets" as far as decoding is concerned.
 */
const MAX_REPORTED_SNR_DB = 60;

/** Half-steps either side of a bin when refining the acquisition offset. */
const REFINE_STEPS = 12;
/** Only steer the timing loop on symbols whose peak clears this SNR, in dB. */
const TRACK_MIN_CONF = 8;

const STATE_SEARCH = 0;
const STATE_ARMED = 1;
const STATE_DATA = 2;
const STATE_NAMES = ['searching', 'syncing', 'decoding'];

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Iterative radix-2 FFT, decimation-in-time, e^-j convention. */
function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let j = 0; j < levels; j++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r >>> 0;
  }
  const half = n >> 1;
  const cosT = new Float64Array(half);
  const sinT = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cosT[i] = Math.cos((TWO_PI * i) / n);
    sinT[i] = Math.sin((TWO_PI * i) / n);
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const h = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + h; j++, k += step) {
          const l = j + h;
          const tre = re[l] * cosT[k] + im[l] * sinT[k];
          const tim = -re[l] * sinT[k] + im[l] * cosT[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
}

class WWDemodCore {
  /**
   * @param {object} cfg  sampleRate, fc, decim, N, sf, preamble, fir,
   *                      upRe/upIm/downRe/downIm, thresholdDb, minPreamblePeaks,
   *                      maxSymbols
   * @param {(msg: object) => void} emit
   */
  constructor(cfg, emit) {
    this.emit = emit;
    this.sampleRate = cfg.sampleRate;
    this.fc = cfg.fc;
    this.decim = cfg.decim;
    this.N = cfg.N;
    this.sf = cfg.sf;
    this.preamble = cfg.preamble;
    this.minPeaks = cfg.minPreamblePeaks || 3;
    this.maxSymbols = cfg.maxSymbols || 640;
    this.thresholdRatio = Math.pow(10, (cfg.thresholdDb === undefined ? 11 : cfg.thresholdDb) / 10);
    this.trackKp = cfg.trackKp === undefined ? TRACK_KP : cfg.trackKp;
    this.trackKi = cfg.trackKi === undefined ? TRACK_KI : cfg.trackKi;

    this.fir = cfg.fir;
    this.firLen = cfg.fir.length;
    this.upRe = cfg.upRe;
    this.upIm = cfg.upIm;
    this.downRe = cfg.downRe;
    this.downIm = cfg.downIm;

    // --- carrier mixer ---
    this.mixPhase = 0;
    this.mixStep = (-TWO_PI * this.fc) / this.sampleRate;

    // --- mixed-input history feeding the decimating FIR ---
    this.histLen = nextPow2(this.firLen);
    this.histMask = this.histLen - 1;
    this.histRe = new Float32Array(this.histLen);
    this.histIm = new Float32Array(this.histLen);
    this.histPos = 0;
    // Sampling instants are scheduled on a fractional timeline rather than by
    // a modulo counter, so the receiver can slide its chip grid onto the
    // transmitter's without ever gaining or losing an output sample.
    this.inputIndex = 0;
    this.nextOutputAt = this.decim - 1;

    // --- complex baseband ring ---
    this.bbLen = nextPow2(Math.max(this.N * (this.preamble + 6), 4096));
    this.bbMask = this.bbLen - 1;
    this.bbRe = new Float32Array(this.bbLen);
    this.bbIm = new Float32Array(this.bbLen);
    this.bbCount = 0; // total baseband samples ever produced

    // --- FFT scratch ---
    this.fft = makeFFT(this.N);
    this.fRe = new Float64Array(this.N);
    this.fIm = new Float64Array(this.N);
    this.dRe = new Float64Array(this.N);
    this.dIm = new Float64Array(this.N);

    // --- detector state ---
    this.state = STATE_SEARCH;
    this.noiseEma = 0;
    this.noiseAlpha = Math.min(0.02, 1 / Math.max(64, this.N * 4));
    this.mag1 = 0;
    this.mag2 = 0;
    this.dnMag1 = 0;
    this.dnMag2 = 0;
    this.lastPeakPos = -1;
    // One candidate per propagation path: a room echoes, so a single preamble
    // chirp lands several times and each arrival keeps its own symbol clock.
    this.pathPhase = new Int32Array(MAX_PATHS);
    this.pathLast = new Int32Array(MAX_PATHS);
    this.pathCount = new Int32Array(MAX_PATHS);
    this.pathLevel = new Float64Array(MAX_PATHS);
    this.pathN = 0;
    this.tol = Math.max(2, this.N >> 6);
    this.armStart = 0;
    this.preambleLevel = 0;
    this.sfdFirst = -1;
    this.sfdDeadline = 0;
    this.dataStart = 0;
    this.binOffset = 0;
    this.binRate = 0;
    this.timingAdj = 0;
    this.symbolIndex = 0;
    this.warmup = this.N * 3 + Math.ceil(this.firLen / this.decim);

    // --- reporting ---
    this.peakSnrDb = -99;
    this.rms = 0;
    this.reportEvery = Math.max(1, Math.round(this.sampleRate / 20 / this.decim));
    this.reportCounter = 0;
    this.lastReportedState = -1;
  }

  reset(hard) {
    this.state = STATE_SEARCH;
    this.lastPeakPos = -1;
    // Dropping the path count is enough: every slot is re-initialised when it
    // is claimed. Reallocating here would put a fresh allocation on the audio
    // thread after every frame, which is exactly where garbage is unwelcome.
    this.pathN = 0;
    this.preambleLevel = 0;
    this.sfdFirst = -1;
    this.symbolIndex = 0;
    this.binOffset = 0;
    this.binRate = 0;
    this.timingAdj = 0;
    if (hard) {
      this.noiseEma = 0;
      this.bbCount = 0;
      this.peakSnrDb = -99;
    }
  }

  /** Feed one render quantum of microphone samples. */
  push(input) {
    const n = input.length;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = input[i];
      sumSq += x * x;

      // Mix to complex baseband. Direct trig keeps the NCO drift-free; at one
      // render quantum per 2.7 ms the cost is negligible.
      const c = Math.cos(this.mixPhase);
      const s = Math.sin(this.mixPhase);
      this.mixPhase += this.mixStep;
      if (this.mixPhase < -TWO_PI) this.mixPhase += TWO_PI;

      this.histRe[this.histPos] = x * c;
      this.histIm[this.histPos] = x * s;
      this.histPos = (this.histPos + 1) & this.histMask;

      if (this.inputIndex >= this.nextOutputAt) {
        this.nextOutputAt += this.decim;
        this.filterAndProcess();
      }
      this.inputIndex++;
    }
    const inst = Math.sqrt(sumSq / Math.max(1, n));
    this.rms = this.rms * 0.85 + inst * 0.15;
  }

  /** Polyphase-style output: the FIR only runs on samples we actually keep. */
  filterAndProcess() {
    const { fir, firLen, histRe, histIm, histMask } = this;
    let base = (this.histPos - firLen) & histMask;
    let re = 0;
    let im = 0;
    for (let k = 0; k < firLen; k++) {
      const idx = (base + k) & histMask;
      const h = fir[k];
      re += histRe[idx] * h;
      im += histIm[idx] * h;
    }
    const w = this.bbCount & this.bbMask;
    this.bbRe[w] = re;
    this.bbIm[w] = im;
    this.bbCount++;
    this.onBasebandSample();
  }

  /**
   * Slide every future sampling instant by `chips` (positive = sample later).
   *
   * De-chirping only yields a clean tone when the receiver samples on the same
   * chip grid the transmitter used. A spectral rotation cannot stand in for
   * that: the reference chirp is band-limited, so evaluating it at integer
   * chips while the signal arrives offset leaves a mismatch no phase ramp
   * removes. Moving the sampling instants themselves is both exact and free -
   * the decimator simply fires on different input samples. Resolution is one
   * input sample, or 1/decim of a chip.
   */
  shiftSampling(chips) {
    const delta = chips * this.decim;
    const limit = this.decim * 0.5;
    this.nextOutputAt += delta > limit ? limit : delta < -limit ? -limit : delta;
  }

  /** Correlate the last N baseband samples against a conjugated reference. */
  correlate(refRe, refIm) {
    const { bbRe, bbIm, bbMask, N } = this;
    const start = this.bbCount - N;
    let re = 0;
    let im = 0;
    for (let k = 0; k < N; k++) {
      const idx = (start + k) & bbMask;
      const ar = bbRe[idx];
      const ai = bbIm[idx];
      const br = refRe[k];
      const bi = refIm[k];
      re += ar * br - ai * bi;
      im += ar * bi + ai * br;
    }
    return re * re + im * im;
  }

  onBasebandSample() {
    if (this.bbCount < this.N) return;

    if (this.state === STATE_DATA) {
      this.collectData();
      this.maybeReport();
      return;
    }

    const mag = this.correlate(this.upRe, this.upIm);

    // Outlier-clipped EMA: a real preamble is a train of huge spikes, and an
    // unclipped average would drag the floor up until detection stops working.
    if (this.noiseEma <= 0) this.noiseEma = mag + 1e-12;
    else {
      const clipped = mag < this.noiseEma * 4 ? mag : this.noiseEma * 4;
      this.noiseEma += this.noiseAlpha * (clipped - this.noiseEma);
    }

    const thresh = this.noiseEma * this.thresholdRatio;
    const ready = this.bbCount > this.warmup;

    // 3-tap local maximum: the middle sample is the peak.
    const isPeak = ready && this.mag1 > this.mag2 && this.mag1 >= mag && this.mag1 > thresh;
    const peakVal = this.mag1;
    const peakPos = this.bbCount - 2;
    this.mag2 = this.mag1;
    this.mag1 = mag;

    // Reject sidelobes and cross-correlation leakage, but stay generous enough
    // that a genuine weaker reflection can still open its own path candidate.
    if (isPeak && this.preambleLevel > 0 && peakVal < this.preambleLevel * PEAK_RELATIVE) {
      if (this.state === STATE_ARMED) this.trackSfd();
      this.maybeReport();
      return;
    }

    if (isPeak) {
      const snr = Math.min(
        MAX_REPORTED_SNR_DB,
        10 * Math.log10(peakVal / Math.max(this.noiseEma, 1e-20)),
      );
      this.peakSnrDb = Math.max(this.peakSnrDb, snr);
      if (this.state === STATE_SEARCH) {
        this.notePeak(peakPos, peakVal);
        this.tryArm(snr);
      } else if (Math.abs((((peakPos - this.lastPeakPos) % this.N) + this.N) % this.N) <= this.tol) {
        // Armed: only let the locked path advance the symbol clock.
        this.lastPeakPos = peakPos;
      }
    }

    if (this.state === STATE_ARMED) this.trackSfd();

    this.maybeReport();
  }

  /**
   * File a correlation peak against a propagation path.
   *
   * Every path repeats on the same N-chip clock but at its own phase, so the
   * peak's position modulo N identifies which arrival it belongs to. Grouping
   * by phase - rather than demanding one strictly periodic run of peaks - is
   * what lets acquisition survive a reverberant room: echoes simply open
   * candidates of their own instead of breaking the direct path's run.
   */
  notePeak(pos, value) {
    const phase = ((pos % this.N) + this.N) % this.N;
    const stale = this.N * 3;

    let slot = -1;
    for (let i = 0; i < this.pathN; i++) {
      if (pos - this.pathLast[i] > stale) {
        this.pathCount[i] = 0; // path went quiet; treat it as fresh
        this.pathLevel[i] = 0;
      }
      let d = Math.abs(phase - this.pathPhase[i]);
      if (d > this.N / 2) d = this.N - d;
      if (d <= this.tol) {
        slot = i;
        break;
      }
    }

    if (slot < 0) {
      if (this.pathN < MAX_PATHS) {
        slot = this.pathN++;
      } else {
        // Evict the weakest tracked path.
        slot = 0;
        for (let i = 1; i < this.pathN; i++) if (this.pathLevel[i] < this.pathLevel[slot]) slot = i;
      }
      this.pathCount[slot] = 0;
      this.pathLevel[slot] = 0;
    }

    this.pathPhase[slot] = phase;
    this.pathLast[slot] = pos;
    this.pathCount[slot] = this.pathCount[slot] + 1;
    if (value > this.pathLevel[slot]) this.pathLevel[slot] = value;
    if (value > this.preambleLevel) this.preambleLevel = value;
  }

  /** Arm on the loudest path that has repeated often enough to be a preamble. */
  tryArm(snr) {
    let best = -1;
    for (let i = 0; i < this.pathN; i++) {
      if (this.pathCount[i] < this.minPeaks) continue;
      if (best < 0 || this.pathLevel[i] > this.pathLevel[best]) best = i;
    }
    if (best < 0) return;

    this.state = STATE_ARMED;
    this.armStart = this.bbCount;
    this.lastPeakPos = this.pathLast[best];
    this.preambleLevel = this.pathLevel[best];
    this.sfdFirst = -1;
    this.emit({ type: 'sync', snrDb: snr });
  }

  /**
   * The delimiter is two down-chirps. We latch on the first, then confirm the
   * second exactly N chips later; if the confirmation never lands we assume it
   * was lost and extrapolate, which recovers frames whose SFD was clipped by a
   * momentary dropout.
   */
  trackSfd() {
    const mag = this.correlate(this.downRe, this.downIm);

    // Two independent gates. The level gate is relative to the preamble's own
    // correlation peak (an up-chirp leaks into the down-chirp filter at roughly
    // -10*log10(N) dB, so SFD_RELATIVE sits comfortably between the two). The
    // grid gate demands the peak fall on the symbol clock the preamble already
    // established, which kills the mid-symbol leakage peaks outright.
    const thresh = Math.max(this.noiseEma * this.thresholdRatio, this.preambleLevel * SFD_RELATIVE);
    const isPeak = this.dnMag1 > this.dnMag2 && this.dnMag1 >= mag && this.dnMag1 > thresh;
    const peakPos = this.bbCount - 2;
    this.dnMag2 = this.dnMag1;
    this.dnMag1 = mag;

    if (isPeak && this.onGrid(peakPos)) {
      if (this.sfdFirst < 0) {
        this.sfdFirst = peakPos;
        this.sfdDeadline = this.bbCount + this.N + this.tol * 2;
      } else if (Math.abs(peakPos - this.sfdFirst - this.N) <= this.tol) {
        this.beginData(peakPos + 1);
        return;
      }
    }

    if (this.sfdFirst >= 0 && this.bbCount > this.sfdDeadline) {
      this.beginData(this.sfdFirst + this.N + 1);
      return;
    }

    if (this.bbCount - this.armStart > (this.preamble + 10) * this.N) this.reset(false);
  }

  /** Is `pos` an whole number of symbols away from the last preamble peak? */
  onGrid(pos) {
    if (this.lastPeakPos < 0) return true;
    const d = (((pos - this.lastPeakPos) % this.N) + this.N) % this.N;
    return Math.min(d, this.N - d) <= this.tol;
  }

  beginData(start) {
    this.state = STATE_DATA;
    this.dataStart = start;
    this.symbolIndex = 0;
    this.timingAdj = 0;
    const est = this.estimateTiming(start);
    // Re-grid onto the transmitter's chips; only the sub-sample remainder is
    // left for the spectral rotation to mop up.
    this.shiftSampling(-est.offset);
    this.binOffset = est.offset - Math.round(est.offset * this.decim) / this.decim;
    this.binRate = est.rate;
    this.emit({ type: 'frameStart', snrDb: this.peakSnrDb, binOffset: est.offset, binRate: est.rate });
  }

  /**
   * Recover sub-chip timing *and* clock drift from the preamble.
   *
   * The correlator only aligns to a whole baseband sample, and one sample is
   * one chip is one FFT bin - so leftover sub-sample delay smears every symbol
   * between two bins. Worse, two devices' crystals differ by tens of ppm, so
   * that offset does not merely exist, it ramps: over a multi-second long-range
   * frame it slides past a whole chip.
   *
   * Preamble chirps all carry symbol 0, so the fractional bin each one lands at
   * *is* the timing error at that instant. Fitting a line through them yields
   * both the starting offset and the drift rate, which seeds the tracking loop
   * already converged - a loop that has to acquire the ramp from zero spends
   * its first few dozen symbols lagging, and lag past half a bin is a cycle
   * slip that never heals.
   */
  estimateTiming(start) {
    const pts = [];
    // back = 1,2 are the SFD down-chirps; the up-chirps start at 3.
    for (let back = this.preamble + 2; back >= 3; back--) {
      const from = start - back * this.N;
      if (from < 0 || start - from > this.bbLen - this.N) continue;
      const f = this.peakFraction(from);
      if (f !== null) pts.push({ t: -back, f });
    }
    if (pts.length === 0) return { offset: 0, rate: 0 };
    if (pts.length === 1) return { offset: pts[0].f, rate: 0 };

    // Points arrive oldest-first; unwrap so a drift crossing a bin boundary
    // reads as a continuing ramp rather than a jump.
    for (let i = 1; i < pts.length; i++) {
      while (pts[i].f - pts[i - 1].f > 0.5) pts[i].f -= 1;
      while (pts[i].f - pts[i - 1].f < -0.5) pts[i].f += 1;
    }

    let st = 0;
    let sf = 0;
    let stt = 0;
    let stf = 0;
    for (const p of pts) {
      st += p.t;
      sf += p.f;
      stt += p.t * p.t;
      stf += p.t * p.f;
    }
    const n = pts.length;
    const den = n * stt - st * st;
    let rate = den !== 0 ? (n * stf - st * sf) / den : 0;
    if (rate > TRACK_MAX_RATE) rate = TRACK_MAX_RATE;
    else if (rate < -TRACK_MAX_RATE) rate = -TRACK_MAX_RATE;
    let offset = (sf - rate * st) / n; // extrapolated to the first data symbol
    if (offset > 0.5) offset -= 1;
    else if (offset < -0.5) offset += 1;
    return { offset, rate };
  }

  /**
   * Distance of the peak from bin 0, in bins, over (-N/2, N/2].
   *
   * The fractional part is found by directly maximising the DTFT magnitude over
   * a fine grid of offsets rather than by interpolating three FFT bins.
   * Interpolation is cheaper but biased - parabolic fitting under-reads a
   * half-bin offset badly - and at acquisition that bias is fatal: it leaves
   * the receiver sitting near the half-bin boundary where every symbol rounds
   * to whichever of two neighbours the noise favours. This runs once per frame,
   * so the extra O(N) per candidate is free.
   */
  peakFraction(startAbs) {
    const { N, dRe, dIm } = this;
    this.dechirp(startAbs, 0);
    dRe.set(this.fRe);
    dIm.set(this.fIm);
    this.fft(this.fRe, this.fIm);

    let best = 0;
    let bestP = -1;
    for (let k = 0; k < N; k++) {
      const p = this.fRe[k] * this.fRe[k] + this.fIm[k] * this.fIm[k];
      if (p > bestP) {
        bestP = p;
        best = k;
      }
    }
    if (bestP <= 0) return null;

    let bin = best;
    if (bin > N / 2) bin -= N;

    let bestOff = 0;
    let bestMag = -1;
    for (let i = -REFINE_STEPS; i <= REFINE_STEPS; i++) {
      const off = (i * 0.5) / REFINE_STEPS;
      const mag = this.dtftMagnitude(bin + off);
      if (mag > bestMag) {
        bestMag = mag;
        bestOff = off;
      }
    }

    const frac = bin + bestOff;
    return Math.abs(frac) > 1.6 ? null : frac;
  }

  /** |DTFT| squared of the de-chirped window at fractional bin `bin`. */
  dtftMagnitude(bin) {
    const { N, dRe, dIm } = this;
    const w = (-TWO_PI * bin) / N;
    const dr = Math.cos(w);
    const di = Math.sin(w);
    let cr = 1;
    let ci = 0;
    let re = 0;
    let im = 0;
    for (let k = 0; k < N; k++) {
      re += dRe[k] * cr - dIm[k] * ci;
      im += dRe[k] * ci + dIm[k] * cr;
      const ncr = cr * dr - ci * di;
      ci = cr * di + ci * dr;
      cr = ncr;
    }
    return re * re + im * im;
  }

  /**
   * Sub-bin position of the peak, by parabolic interpolation over the peak and
   * its two neighbours.
   *
   * The obvious closed form for a Dirichlet kernel, |X[k+1]|/|X[k]| = d/(1-d),
   * looks more principled but has no zero: real symbols carry a symmetric
   * sidelobe floor from window straddling and filtering, and that form reads a
   * standing +/-0.2 bin error off it, which walks the timing loop into a cycle
   * slip. A parabola through three points is exactly zero when the neighbours
   * match, which is the property a discriminator actually needs.
   */
  interpolatePeak(best) {
    const { N, fRe, fIm } = this;
    const km = (best - 1 + N) % N;
    const kp = (best + 1) % N;
    const a = Math.hypot(fRe[km], fIm[km]);
    const b = Math.hypot(fRe[best], fIm[best]);
    const c = Math.hypot(fRe[kp], fIm[kp]);
    const den = a - 2 * b + c;
    if (den >= -1e-20) return 0;
    const d = (0.5 * (a - c)) / den;
    return d > 0.5 ? 0.5 : d < -0.5 ? -0.5 : d;
  }

  /**
   * Multiply the window by the conjugate base chirp, optionally rotating by
   * `-binOffset` bins to undo the residual timing error. Result lands in
   * fRe/fIm ready for the FFT.
   */
  dechirp(startAbs, binOffset) {
    const { bbRe, bbIm, bbMask, N, upRe, upIm, fRe, fIm } = this;
    const w = (-TWO_PI * binOffset) / N;
    let cr = 1;
    let ci = 0;
    const dr = Math.cos(w);
    const di = Math.sin(w);
    for (let k = 0; k < N; k++) {
      const idx = (startAbs + k) & bbMask;
      const ar = bbRe[idx];
      const ai = bbIm[idx];
      const br = upRe[k];
      const bi = upIm[k];
      let xr = ar * br - ai * bi;
      let xi = ar * bi + ai * br;
      if (binOffset !== 0) {
        const tr = xr * cr - xi * ci;
        xi = xr * ci + xi * cr;
        xr = tr;
        const ncr = cr * dr - ci * di;
        ci = cr * di + ci * dr;
        cr = ncr;
      }
      fRe[k] = xr;
      fIm[k] = xi;
    }
  }

  collectData() {
    const startAbs = this.dataStart + this.timingAdj + this.symbolIndex * this.N;
    if (startAbs < 0) {
      this.reset(false);
      return;
    }
    if (this.bbCount < startAbs + this.N) return;
    // Guard against the ring wrapping past data we have not consumed yet.
    if (this.bbCount - startAbs > this.bbLen) {
      this.reset(false);
      return;
    }
    this.emitSymbol(startAbs);
    this.symbolIndex++;
    if (this.symbolIndex >= this.maxSymbols) this.reset(false);
  }

  /**
   * De-chirp the window and FFT it. A cyclically shifted chirp multiplied by
   * the conjugate base chirp collapses to a single tone, so the peak bin is the
   * transmitted symbol and the peak-to-background ratio is its confidence.
   */
  emitSymbol(startAbs) {
    this.dechirp(startAbs, this.binOffset);
    this.fft(this.fRe, this.fIm);
    const { N, fRe, fIm } = this;

    let best = 0;
    let bestP = -1;
    let total = 0;
    for (let k = 0; k < N; k++) {
      const p = fRe[k] * fRe[k] + fIm[k] * fIm[k];
      total += p;
      if (p > bestP) {
        bestP = p;
        best = k;
      }
    }

    // Decision margin: how far the winning bin beats its nearest rival.
    //
    // Peak-against-average would be the obvious confidence measure, but a
    // symbol is not misread because the noise floor rose - it is misread
    // because one other bin overtook the right one. Measuring that margin makes
    // the score actually predictive, which is what the Reed-Solomon erasure
    // path needs to spend its budget on the symbols that are truly wrong. The
    // two bins either side are skipped: they hold this symbol's own spectral
    // leakage, not a competing hypothesis.
    let rivalP = 0;
    for (let k = 0; k < N; k++) {
      let d = Math.abs(k - best);
      if (d > N / 2) d = N - d;
      if (d <= 1) continue;
      const p = fRe[k] * fRe[k] + fIm[k] * fIm[k];
      if (p > rivalP) rivalP = p;
    }
    const confDb = 10 * Math.log10(bestP / Math.max(rivalP, 1e-20));
    const bg = Math.max((total - bestP) / Math.max(1, N - 1), 1e-20);
    const snrDb = 10 * Math.log10(bestP / bg);

    if (snrDb > TRACK_MIN_CONF) this.steerTiming(best);

    this.emit({ type: 'symbol', index: this.symbolIndex, value: best, confDb, snrDb });
  }

  /**
   * Close the loop on symbol timing.
   *
   * One chip of timing error is exactly one FFT bin of offset, so the residual
   * sub-bin position of the peak *is* the timing error. Two devices' crystals
   * differ by tens of ppm, which over a multi-second frame slides the grid past
   * half a chip - without this the tail of a long message decodes as noise.
   */
  steerTiming(best) {
    const err = this.interpolatePeak(best);
    this.binRate += this.trackKi * err;
    if (this.binRate > TRACK_MAX_RATE) this.binRate = TRACK_MAX_RATE;
    else if (this.binRate < -TRACK_MAX_RATE) this.binRate = -TRACK_MAX_RATE;
    this.binOffset += this.trackKp * err + this.binRate;

    // Anything past half an input sample is worth re-gridding for; that keeps
    // the residual - and so the reference mismatch - down in the noise.
    const quantum = 1 / this.decim;
    if (Math.abs(this.binOffset) > quantum * 0.5) {
      const steps = Math.round(this.binOffset * this.decim);
      this.shiftSampling(-steps * quantum);
      this.binOffset -= steps * quantum;
    }

    // Whole chips still move the window itself, so it keeps straddling the
    // symbol it is meant to read.
    while (this.binOffset > TRACK_TRANSFER) {
      this.binOffset -= 1;
      this.timingAdj -= 1;
    }
    while (this.binOffset < -TRACK_TRANSFER) {
      this.binOffset += 1;
      this.timingAdj += 1;
    }
  }

  maybeReport() {
    if (++this.reportCounter < this.reportEvery && this.state === this.lastReportedState) return;
    this.reportCounter = 0;
    this.lastReportedState = this.state;
    this.emit({
      type: 'metrics',
      state: STATE_NAMES[this.state],
      snrDb: this.peakSnrDb,
      noiseDb: 10 * Math.log10(Math.max(this.noiseEma, 1e-20)),
      rms: this.rms,
      symbolIndex: this.symbolIndex,
    });
    // Let the reported margin sag so the range meter tracks you walking away -
    // but hold it steady mid-frame, where no fresh preamble arrives to renew it.
    if (this.state !== STATE_DATA) this.peakSnrDb = Math.max(-99, this.peakSnrDb - 0.6);
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class WWDemodProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const cfg = options.processorOptions;
      this.core = new WWDemodCore({ ...cfg, sampleRate: cfg.sampleRate || sampleRate }, (msg) =>
        this.port.postMessage(msg),
      );
      this.port.onmessage = (e) => {
        const d = e.data;
        if (d && d.type === 'reset') this.core.reset(!!d.hard);
      };
    }

    process(inputs) {
      const input = inputs[0];
      if (input && input.length > 0 && input[0] && input[0].length) this.core.push(input[0]);
      return true;
    }
  }
  registerProcessor('ww-demod', WWDemodProcessor);
}

globalThis.WWDemodCore = WWDemodCore;
