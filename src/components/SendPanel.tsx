import { useMemo } from 'react';
import { engine } from '../audio/engine';
import { driveGainDb } from '../dsp/modulator';
import { estimateSeconds, deriveParams, PROFILES } from '../dsp/profiles';
import { useStore } from '../store/useStore';
import { Badge, Button, Panel, PanelTitle, Slider, Stat } from './ui';
import {
  Send,
  Radio,
  Square,
  Timer,
  Zap,
  Repeat,
  Volume2,
  Trash2,
  AlertTriangle,
  Flame,
  Waves,
} from 'lucide-react';

function formatDuration(s: number) {
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

const PRESETS = [
  { label: '👋 Hello', text: 'Hello from WhisperWave! 🌊' },
  { label: '🔑 Token', text: 'TOKEN: #9842-WW-SEC' },
  { label: '📍 GPS', text: 'GPS: 37.7749° N, 122.4194° W' },
  { label: '📡 Beacon', text: 'BEACON PING · AIR LINK OK' },
  { label: '🚨 SOS', text: 'EMERGENCY: Link requested at Sector 4' },
];

export function SendPanel() {
  const {
    profileId,
    draft,
    setDraft,
    volume,
    setVolume,
    drive,
    setDrive,
    transmitting,
    txProgress,
    txLabel,
    setTransmitting,
    sampleRate,
    setError,
  } = useStore();

  const profile = PROFILES[profileId];
  const params = useMemo(() => deriveParams(profile, sampleRate), [profile, sampleRate]);

  const bytes = useMemo(() => new TextEncoder().encode(draft), [draft]);
  const overBudget = bytes.length > params.maxPayloadBytes;
  const budgetRatio = Math.min(1, bytes.length / params.maxPayloadBytes);
  const airtime = bytes.length > 0 && !overBudget ? estimateSeconds(params, bytes.length) : 0;

  const send = async () => {
    if (!draft.trim() || overBudget || transmitting) return;
    try {
      setError(null);
      setTransmitting(true, 'transmitting');
      await engine.transmit(bytes, profile, { volume, drive });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start audio output.');
      setTransmitting(false);
    }
  };

  const ping = async () => {
    if (transmitting) return;
    try {
      setError(null);
      setTransmitting(true, 'range test');
      await engine.rangePing(profile, { volume, drive }, 12);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start audio output.');
      setTransmitting(false);
    }
  };

  const stop = () => {
    engine.stopTransmit();
    setTransmitting(false);
  };

  return (
    <Panel highlight={transmitting} cornerMarks>
      <PanelTitle
        icon={<Radio className="h-4 w-4" />}
        hint={`${bytes.length} / ${params.maxPayloadBytes} B`}
      >
        Acoustic Transmitter Console
      </PanelTitle>

      {/* Preset Quick Chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[0.62rem] font-bold uppercase tracking-wider text-white/40 mr-1">
          Presets:
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={transmitting}
            onClick={() => setDraft(p.text)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/80 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-white transition-all disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Textarea Console with Clear Action */}
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="Type the message to transmit through soundwaves…"
          disabled={transmitting}
          className="w-full resize-none rounded-2xl border border-white/12 bg-black/50 p-3.5 text-sm sm:text-base text-white/95 placeholder:text-white/30 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60 font-sans shadow-inner"
        />

        {draft.length > 0 && !transmitting && (
          <button
            type="button"
            onClick={() => setDraft('')}
            title="Clear text"
            aria-label="Clear text"
            className="absolute right-3 bottom-3 rounded-lg bg-white/10 p-1.5 text-white/60 hover:bg-white/20 hover:text-white transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Stitch Neon Progress Bar for Byte Budget */}
      <div className="mt-2.5">
        <div className="mb-1 flex justify-between text-[0.65rem] font-bold text-white/50 uppercase tracking-wider">
          <span>Codeword Capacity</span>
          <span className="num text-cyan-300">
            {bytes.length} / {params.maxPayloadBytes} Bytes ({Math.round(budgetRatio * 100)}%)
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-black/60 border border-white/10 scanline">
          <div
            className={`h-full transition-all duration-200 rounded-full ${
              overBudget
                ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'
                : budgetRatio > 0.85
                ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]'
                : 'accent-bg shadow-[0_0_12px_var(--accent)]'
            }`}
            style={{ width: `${budgetRatio * 100}%` }}
          />
        </div>
      </div>

      {overBudget && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 p-3 text-xs font-bold text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>
            Exceeds single-codeword limit by{' '}
            <strong className="num text-white">
              {bytes.length - params.maxPayloadBytes} bytes
            </strong>
            . Shorten payload.
          </span>
        </div>
      )}

      {/* Transmission Metrics Stats */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat
          icon={<Timer className="h-3.5 w-3.5" />}
          label="Est. Airtime"
          value={airtime ? formatDuration(airtime) : '—'}
        />
        <Stat
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Baud Rate"
          value={params.bitsPerSecond.toFixed(0)}
          unit="b/s"
        />
        <Stat
          icon={<Repeat className="h-3.5 w-3.5" />}
          label="Redundancy"
          value={`${params.repeats}×`}
          unit="bursts"
        />
      </div>

      {/* Audio Controls (Sliders) */}
      <div className="mt-4 space-y-3">
        <Slider
          icon={<Volume2 className="h-3.5 w-3.5" />}
          label="Speaker Output Level"
          value={volume}
          min={0.1}
          max={1}
          step={0.01}
          onChange={setVolume}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        {profile.inaudible ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-white/50">
            <span className="font-bold text-white/80">Power Boost:</span> Bypassed on inaudible carriers. Non-linear clipping introduces audible harmonic foldback.
          </div>
        ) : (
          <Slider
            icon={<Flame className="h-3.5 w-3.5 text-amber-400" />}
            label="Signal Boost (Soft-Clipping Drive)"
            value={drive}
            min={1}
            max={5}
            step={0.1}
            onChange={setDrive}
            format={(v) => (v <= 1.05 ? 'Off — Pure Linear' : `+${driveGainDb(v).toFixed(1)} dB In-Band`)}
          />
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-5">
        {transmitting ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 p-3.5 sm:p-4 shadow-xl neon-glow">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className="flex h-6 items-end gap-1 shrink-0">
                    <span className="h-full w-1 rounded-full bg-rose-400 wave-anim-1" />
                    <span className="h-full w-1 rounded-full bg-rose-400 wave-anim-2" />
                    <span className="h-full w-1 rounded-full bg-rose-400 wave-anim-3" />
                    <span className="h-full w-1 rounded-full bg-rose-400 wave-anim-4" />
                    <span className="h-full w-1 rounded-full bg-rose-400 wave-anim-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[0.62rem] sm:text-[0.65rem] font-extrabold uppercase tracking-widest text-rose-300 truncate">
                      EMITTING SOUND BURST
                    </div>
                    <div className="num text-sm sm:text-base font-black text-white truncate">
                      {txLabel.toUpperCase()} · {Math.round(txProgress * 100)}%
                    </div>
                  </div>
                </div>

                <Button
                  variant="danger"
                  size="md"
                  onClick={stop}
                  icon={<Square className="h-4 w-4 fill-current" />}
                  className="shrink-0"
                >
                  ABORT
                </Button>
              </div>

              {/* Animated Progress Bar */}
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/60 border border-rose-500/30 scanline">
                <div
                  className="h-full bg-rose-500 transition-all duration-150 rounded-full shadow-[0_0_12px_#f43f5e]"
                  style={{ width: `${txProgress * 100}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
            <Button
              variant="accent"
              size="lg"
              onClick={send}
              disabled={!draft.trim() || overBudget}
              icon={<Send className="h-4 w-4" />}
              scanline
              className="w-full flex-1 text-sm sm:text-base font-black tracking-widest uppercase shadow-[0_0_20px_var(--accent-glow)]"
            >
              TRANSMIT WAVEFORM
            </Button>
            <Button
              size="lg"
              onClick={ping}
              icon={<Waves className="h-4 w-4" />}
              title="Emit continuous acoustic chirp sequence to test link range"
              className="w-full sm:w-auto text-xs sm:text-sm font-bold uppercase"
            >
              Range Test Ping
            </Button>
          </div>
        )}
      </div>

      {/* Deployment Guidance Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3">
        <Badge tone={profile.inaudible ? 'accent' : 'warn'}>
          {profile.inaudible ? 'Ultrasonic Silent Band' : 'Acoustic Chirp Spread Spectrum'}
        </Badge>
        <span className="text-[0.68rem] font-medium text-white/45">
          Turn device volume to 80–100% · Direct speaker toward microphone
        </span>
      </div>
    </Panel>
  );
}
