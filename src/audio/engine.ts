/**
 * Owns the AudioContext, the transmit path and the receive path.
 *
 * Deliberately framework-free: React components call into it and subscribe to
 * callbacks, so nothing here re-renders and the audio graph survives every
 * re-render above it.
 */

import { buildDemodTables } from '../dsp/chirp';
import { renderRangePing, renderTransmission, type ModulationOptions } from '../dsp/modulator';
import { deriveParams, type Profile, type RadioParams } from '../dsp/profiles';
import type { ProfileBand } from '../dsp/emitters';
import { FrameAssembler, type DecodedMessage, type ReceiverPhase } from './frameAssembler';
import { MIC_CONSTRAINTS, describeTrack, type MicReport } from './hardwareConfig';
import { checkReceiveSupport } from './secureContext';
import { spatialAnalyzer } from './directionFinder';
import { spectrumScanner } from './spectrumScanner';

const WORKLET_URL = `${import.meta.env.BASE_URL}ww-demod.worklet.js`;

export interface ReceiveMetrics {
  phase: ReceiverPhase;
  snrDb: number;
  noiseDb: number;
  level: number;
  symbolsSeen: number;
}

export interface FrameProgress {
  stage: 'header' | 'payload';
  have: number;
  need: number;
}

export interface EngineCallbacks {
  onMetrics?: (m: ReceiveMetrics) => void;
  onProgress?: (p: FrameProgress | null) => void;
  onMessage?: (m: DecodedMessage) => void;
  onNotice?: (text: string) => void;
  onTransmitProgress?: (fraction: number) => void;
}

export class AcousticEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private moduleLoaded = false;

  private assembler: FrameAssembler | null = null;
  private params: RadioParams | null = null;
  private playing: AudioBufferSourceNode | null = null;
  private txTimer: number | null = null;

  listening = false;
  scanning = false;
  micReport: MicReport | null = null;

  /** Who currently needs the microphone. The stream closes when this empties. */
  private micUsers = new Set<'decode' | 'scan'>();
  cb: EngineCallbacks = {};

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get spectrumAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Must be reached from a user gesture: mobile Safari and Chrome both create
   * the context suspended otherwise, and every later call silently no-ops.
   */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  /* ------------------------------- transmit ------------------------------ */

  async transmit(payload: Uint8Array, profile: Profile, opts: ModulationOptions): Promise<number> {
    const ctx = await this.ensureContext();
    const params = deriveParams(profile, ctx.sampleRate);
    const tx = renderTransmission(payload, params, opts);
    return this.play(tx.samples, ctx);
  }

  async rangePing(profile: Profile, opts: ModulationOptions, seconds: number): Promise<number> {
    const ctx = await this.ensureContext();
    const params = deriveParams(profile, ctx.sampleRate);
    return this.play(renderRangePing(params, opts, seconds), ctx);
  }

  private play(samples: Float32Array, ctx: AudioContext): number {
    this.stopTransmit();
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const startedAt = ctx.currentTime;
    const duration = buffer.duration;
    src.start();
    this.playing = src;

    const tick = () => {
      if (this.playing !== src) return;
      const f = Math.min(1, (ctx.currentTime - startedAt) / duration);
      this.cb.onTransmitProgress?.(f);
      if (f < 1) this.txTimer = requestAnimationFrame(tick);
    };
    this.txTimer = requestAnimationFrame(tick);

    src.onended = () => {
      if (this.playing === src) {
        this.playing = null;
        this.cb.onTransmitProgress?.(1);
      }
    };
    return duration;
  }

  stopTransmit() {
    if (this.txTimer !== null) cancelAnimationFrame(this.txTimer);
    this.txTimer = null;
    if (this.playing) {
      try {
        this.playing.stop();
      } catch {
        /* already stopped */
      }
      this.playing = null;
    }
  }

  /* -------------------------------- receive ------------------------------ */

  /**
   * Open the microphone once and share it. The demodulator and the ambient
   * scanner both want the same raw stream, and asking for a second one costs
   * another permission prompt on some browsers - and on others silently
   * returns a stream with the voice processing switched back on.
   */
  private async ensureMic(ctx: AudioContext, user: 'decode' | 'scan'): Promise<MediaStreamAudioSourceNode> {
    const support = checkReceiveSupport();
    if (!support.ok) throw new Error(support.reason ?? 'Microphone access is not supported here.');

    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const track = this.stream.getAudioTracks()[0];
      if (track) {
        this.micReport = describeTrack(track);
        if (this.micReport.noiseSuppression || this.micReport.echoCancellation || this.micReport.autoGainControl) {
          this.cb.onNotice?.(
            'This browser kept its voice processing on. Range will be reduced - try Chrome, or a different microphone.',
          );
        }
      }
      this.source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.55;
      this.source.connect(this.analyser);
    }
    this.micUsers.add(user);
    return this.source as MediaStreamAudioSourceNode;
  }

  /** Close the stream once nothing is using it any more. */
  private releaseMic(user: 'decode' | 'scan') {
    this.micUsers.delete(user);
    if (this.micUsers.size > 0) return;
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async startListening(profile: Profile): Promise<void> {
    const ctx = await this.ensureContext();

    if (!this.moduleLoaded) {
      await ctx.audioWorklet.addModule(WORKLET_URL);
      this.moduleLoaded = true;
    }

    const source = await this.ensureMic(ctx, 'decode');
    this.attachWorklet(profile, ctx);
    spatialAnalyzer.attach(ctx, source);
    this.listening = true;
  }

  /** Wideband ambient scan. Independent of decoding - either can run alone. */
  async startScanning(bands: ProfileBand[]): Promise<void> {
    const ctx = await this.ensureContext();
    const source = await this.ensureMic(ctx, 'scan');
    spectrumScanner.setProfileBands(bands);
    spectrumScanner.attach(ctx, source);
    this.scanning = true;
  }

  stopScanning() {
    spectrumScanner.detach();
    this.scanning = false;
    this.releaseMic('scan');
  }

  /** Rebuild the demodulator for a new profile without dropping the mic. */
  retune(profile: Profile) {
    if (!this.listening || !this.ctx) return;
    this.attachWorklet(profile, this.ctx);
    if (this.source) {
      spatialAnalyzer.attach(this.ctx, this.source);
    }
  }

  private attachWorklet(profile: Profile, ctx: AudioContext) {
    this.detachWorklet();

    const params = deriveParams(profile, ctx.sampleRate);
    this.params = params;
    this.assembler = new FrameAssembler(params);
    const tables = buildDemodTables(params);

    const node = new AudioWorkletNode(ctx, 'ww-demod', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        sampleRate: ctx.sampleRate,
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
    });
    node.port.onmessage = (e) => this.handleWorkletMessage(e.data, node);

    // A worklet only runs while it is pulled by the graph, so route it into a
    // muted gain node rather than leaving its output dangling.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);

    this.source?.connect(node);
    this.worklet = node;
    this.sink = sink;
  }

  private detachWorklet() {
    if (this.worklet) {
      try {
        this.source?.disconnect(this.worklet);
      } catch {
        /* not connected */
      }
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.sink?.disconnect();
    this.sink = null;
  }

  private handleWorkletMessage(msg: Record<string, unknown>, node: AudioWorkletNode) {
    if (!this.assembler || !this.params) return;

    switch (msg.type) {
      case 'metrics':
        this.cb.onMetrics?.({
          phase: msg.state as ReceiverPhase,
          snrDb: msg.snrDb as number,
          noiseDb: msg.noiseDb as number,
          level: msg.rms as number,
          symbolsSeen: msg.symbolIndex as number,
        });
        break;

      case 'frameStart':
        this.assembler.reset(msg.snrDb as number);
        this.cb.onProgress?.(this.assembler.progress);
        break;

      case 'symbol': {
        const out = this.assembler.push(msg.index as number, msg.value as number, msg.confDb as number);
        if (out.kind === 'collecting' || out.kind === 'headerLocked') {
          this.cb.onProgress?.(this.assembler.progress);
          break;
        }
        // Either way the frame is finished with; rearm for the next repeat.
        if (out.kind === 'decoded') this.cb.onMessage?.(out.message);
        this.cb.onProgress?.(null);
        node.port.postMessage({ type: 'reset' });
        this.assembler.reset();
        break;
      }
    }
  }

  stopListening() {
    spatialAnalyzer.detach();
    this.detachWorklet();
    this.assembler = null;
    this.listening = false;
    this.releaseMic('decode');
  }

  dispose() {
    this.stopTransmit();
    this.stopListening();
    this.stopScanning();
    this.ctx?.close();
    this.ctx = null;
    this.moduleLoaded = false;
  }
}

export const engine = new AcousticEngine();
