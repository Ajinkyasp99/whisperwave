import { useMemo } from 'react';
import { engine } from '../audio/engine';
import { checkReceiveSupport } from '../audio/secureContext';
import { deriveParams, PROFILES } from '../dsp/profiles';
import { useStore } from '../store/useStore';
import { SignalMeter } from './SignalMeter';
import { Spectrum } from './Spectrum';
import { Button, Panel, PanelTitle, Stat } from './ui';

export function ListenPanel() {
  const {
    profileId, listening, setListening, phase, snrDb, level,
    progress, sampleRate, messages, setError, setSampleRate,
  } = useStore();

  const profile = PROFILES[profileId];
  const params = useMemo(() => deriveParams(profile, sampleRate), [profile, sampleRate]);
  const support = useMemo(() => checkReceiveSupport(), []);

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

  return (
    <Panel>
      <PanelTitle hint={listening ? `${(sampleRate / 1000).toFixed(1)} kHz` : undefined}>Receive</PanelTitle>

      <Spectrum params={params} active={listening} />

      <div className="mt-4">
        <SignalMeter snrDb={snrDb} phase={listening ? phase : 'stopped'} />
      </div>

      {progress ? (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-[0.7rem]">
            <span className="accent-text">
              {progress.stage === 'header' ? 'reading frame header' : 'reading payload'}
            </span>
            <span className="num text-white/50">
              {progress.have}/{progress.need} symbols
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="accent-bg h-full transition-[width] duration-150" style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="mic level" value={listening ? (20 * Math.log10(Math.max(level, 1e-6))).toFixed(0) : '—'} unit="dBFS" />
        <Stat label="decoded" value={messages.length} />
        <Stat label="chirp" value={(params.symbolSeconds * 1000).toFixed(0)} unit="ms" />
      </div>

      <Button
        variant={listening ? 'ghost' : 'accent'}
        size="lg"
        onClick={toggle}
        disabled={!support.ok}
        className="mt-5 w-full"
      >
        {listening ? 'Stop listening' : 'Start listening'}
      </Button>

      {!support.ok ? (
        <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 p-3">
          <p className="text-[0.75rem] leading-relaxed text-amber-100">{support.reason}</p>
          {support.suggestedUrl ? (
            <p className="mt-2 text-[0.72rem] leading-relaxed text-amber-100/80">
              Restart the server with <code className="num text-amber-200">pnpm dev:https</code>, then open{' '}
              <a href={support.suggestedUrl} className="num underline decoration-amber-300/40 underline-offset-2">
                {support.suggestedUrl.replace(/\/$/, '')}
              </a>{' '}
              and accept the self-signed certificate warning.
            </p>
          ) : null}
        </div>
      ) : !listening ? (
        <p className="mt-3 text-[0.7rem] leading-relaxed text-white/40">
          Voice processing is switched off for this microphone — echo cancellation and noise suppression both treat a
          distant chirp as noise and delete it.
        </p>
      ) : null}
    </Panel>
  );
}
