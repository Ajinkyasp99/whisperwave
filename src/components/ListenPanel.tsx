import { useMemo } from 'react';
import { engine } from '../audio/engine';
import { deriveParams, PROFILES } from '../dsp/profiles';
import { useStore } from '../store/useStore';
import { SignalMeter } from './SignalMeter';
import { Spectrum } from './Spectrum';
import { Button, Panel, PanelTitle, Stat } from './ui';
import {
  Mic,
  MicOff,
  CheckCircle2,
  Clock,
  Activity,
} from 'lucide-react';

export function ListenPanel({ className = '' }: { className?: string } = {}) {
  const {
    profileId,
    listening,
    setListening,
    phase,
    snrDb,
    level,
    progress,
    sampleRate,
    messages,
    setError,
    setSampleRate,
  } = useStore();

  const profile = PROFILES[profileId];
  const params = useMemo(() => deriveParams(profile, sampleRate), [profile, sampleRate]);

  const toggle = async () => {
    if (listening) {
      engine.stopListening();
      setListening(false);
      return;
    }
    try {
      setError(null);
      await engine.startListening(profile);
      setSampleRate(engine.sampleRate);
      setListening(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /denied|NotAllowed/i.test(msg)
          ? 'Microphone access was denied. Allow it in your browser settings, then try again.'
          : `Could not open the microphone: ${msg}`,
      );
    }
  };

  const pct = progress ? Math.min(1, progress.have / Math.max(1, progress.need)) : 0;
  const micDb = listening ? 20 * Math.log10(Math.max(level, 1e-6)) : -99;

  return (
    <Panel highlight={listening} cornerMarks className={`h-full flex flex-col justify-between ${className}`}>
      <PanelTitle
        icon={<Mic className="h-4 w-4" />}
        hint={listening ? `BAND ACTIVE · ${(sampleRate / 1000).toFixed(1)} kHz` : 'OFFLINE'}
      >
        Acoustic Demodulator & Spectrum
      </PanelTitle>

      {/* Start / Stop Listening Hero Button */}
      <div className="mb-4">
        <Button
          variant={listening ? 'ghost' : 'accent'}
          size="lg"
          onClick={toggle}
          icon={listening ? <MicOff className="h-5 w-5 text-rose-400" /> : <Mic className="h-5 w-5" />}
          scanline={!listening}
          className={`w-full text-base font-black tracking-wider uppercase ${
            listening ? 'border-rose-500/30 hover:border-rose-500/60 text-rose-200' : 'neon-glow-lg'
          }`}
        >
          {listening ? 'STOP LISTENING' : 'START LISTENING'}
        </Button>
      </div>

      {/* Live FFT Spectrum Analyzer & Waterfall */}
      <Spectrum params={params} active={listening} />

      {/* Stitch Radar Scope & Link Margin HUD */}
      <div className="mt-4">
        <SignalMeter snrDb={snrDb} phase={listening ? phase : 'stopped'} />
      </div>

      {/* Frame Assembly Symbol Progress Bar (Fixed Container) */}
      <div className="mt-4 rounded-2xl border border-white/12 bg-black/50 p-4 shadow-xl transition-all">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <div className="flex items-center gap-2 font-black uppercase tracking-wider">
            {progress ? (
              <>
                <span className="h-2 w-2 rounded-full accent-bg animate-ping" />
                <span className="accent-text">
                  {progress.stage === 'header' ? 'Syncing Frame Header' : 'Demodulating Payload Codeword'}
                </span>
              </>
            ) : listening ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400/80 animate-pulse" />
                <span className="text-white/60">Listening for Frame Preamble…</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-white/20" />
                <span className="text-white/40">Receiver Standby</span>
              </>
            )}
          </div>
          <span className="num font-extrabold text-white/80">
            {progress
              ? `${progress.have} / ${progress.need} symbols (${Math.round(pct * 100)}%)`
              : listening
              ? 'Standby · Ready'
              : 'Idle'}
          </span>
        </div>

        <div className="h-2.5 overflow-hidden rounded-full bg-black/60 border border-white/10 scanline">
          <div
            className={`h-full transition-all duration-150 rounded-full ${
              progress ? 'accent-bg shadow-[0_0_14px_var(--accent)]' : 'bg-transparent'
            }`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </div>

      {/* Reception Telemetry Stats */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Mic Level"
          value={listening ? micDb.toFixed(0) : '—'}
          unit="dBFS"
        />
        <Stat
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          label="Decoded"
          value={messages.length}
          unit="frames"
        />
        <Stat
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Chirp Dur."
          value={(params.symbolSeconds * 1000).toFixed(0)}
          unit="ms"
        />
      </div>

      {!listening && (
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-white/50">
          <strong className="text-white/80">Zero Audio Filtering:</strong> Echo cancellation, noise suppression, and AGC are bypassed to preserve raw physical chirp frequencies.
        </div>
      )}
    </Panel>
  );
}
