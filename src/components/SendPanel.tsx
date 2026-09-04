import { useMemo } from 'react';
import { engine } from '../audio/engine';
import { driveGainDb } from '../dsp/modulator';
import { estimateSeconds, deriveParams, PROFILES } from '../dsp/profiles';
import { useStore } from '../store/useStore';
import { Badge, Button, Panel, PanelTitle, Slider, Stat } from './ui';

function formatDuration(s: number) {
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function SendPanel() {
  const {
    profileId, draft, setDraft, volume, setVolume, drive, setDrive,
    transmitting, txProgress, txLabel, setTransmitting, sampleRate, setError,
  } = useStore();

  const profile = PROFILES[profileId];
  const params = useMemo(() => deriveParams(profile, sampleRate), [profile, sampleRate]);

  const bytes = useMemo(() => new TextEncoder().encode(draft), [draft]);
  const overBudget = bytes.length > params.maxPayloadBytes;
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
    <Panel>
      <PanelTitle hint={`${bytes.length}/${params.maxPayloadBytes} bytes`}>Transmit</PanelTitle>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="Type the message to send through the air…"
        disabled={transmitting}
        className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-white/90 placeholder:text-white/25 outline-none transition focus:border-white/25 disabled:opacity-60"
      />

      {overBudget ? (
        <p className="mt-2 text-xs text-rose-300">
          {bytes.length - params.maxPayloadBytes} bytes over the single-codeword limit. Shorten the message.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="airtime" value={airtime ? formatDuration(airtime) : '—'} />
        <Stat label="rate" value={params.bitsPerSecond.toFixed(0)} unit="b/s" />
        <Stat label="repeats" value={`${params.repeats}×`} />
      </div>

      <div className="mt-4 space-y-1">
        <Slider
          label="Output level"
          value={volume}
          min={0.1}
          max={1}
          step={0.01}
          onChange={setVolume}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        {profile.inaudible ? (
          <p className="pt-1 text-[0.7rem] leading-relaxed text-white/40">
            Power boost is off on inaudible profiles — squaring up the wave adds harmonics that fold back under
            Nyquist into the audible range, giving the transmission away.
          </p>
        ) : (
          <Slider
            label="Power boost"
            value={drive}
            min={1}
            max={5}
            step={0.1}
            onChange={setDrive}
            format={(v) => (v <= 1.05 ? 'off — pure tone' : `+${driveGainDb(v).toFixed(1)} dB in band`)}
          />
        )}
      </div>

      <div className="mt-5 flex gap-2">
        {transmitting ? (
          <Button variant="danger" size="lg" onClick={stop} className="flex-1">
            Stop — {txLabel} {Math.round(txProgress * 100)}%
          </Button>
        ) : (
          <>
            <Button
              variant="accent"
              size="lg"
              onClick={send}
              disabled={!draft.trim() || overBudget}
              className="flex-1"
            >
              Send
            </Button>
            <Button size="lg" onClick={ping} title="Emit a continuous chirp train to measure range">
              Range test
            </Button>
          </>
        )}
      </div>

      {transmitting ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="accent-bg h-full transition-[width]" style={{ width: `${txProgress * 100}%` }} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={profile.inaudible ? 'accent' : 'warn'}>{profile.audibility}</Badge>
        <span className="text-[0.7rem] text-white/35">Turn the device volume up; point the speaker at the receiver.</span>
      </div>
    </Panel>
  );
}
