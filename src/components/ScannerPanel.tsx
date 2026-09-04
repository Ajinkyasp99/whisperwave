import { useMemo } from 'react';
import { spectrumScanner } from '../audio/spectrumScanner';
import type { EmitterKind, EmitterTrack } from '../dsp/emitters';
import { fmtHz } from '../dsp/emitters';
import { PROFILES, type ProfileId } from '../dsp/profiles';
import { useSpectrumScanner } from '../hooks/useSpectrumScanner';
import { useStore } from '../store/useStore';
import { BandScope } from './BandScope';
import { Badge, Button, Panel, PanelTitle, Segmented, Slider, Stat, Toggle } from './ui';
import {
  Radar,
  Radio,
  Waves,
  Activity,
  Gauge,
  Crosshair,
  Zap,
  Antenna,
  ScanLine,
  Timer,
  TrendingUp,
  Layers,
  Volume2,
  CircleDot,
} from 'lucide-react';

const KIND_TONE: Record<EmitterKind, 'neutral' | 'accent' | 'warn' | 'success' | 'danger'> = {
  whisperwave: 'warn',
  chirp: 'success',
  pulsed: 'accent',
  harmonic: 'neutral',
  broadband: 'neutral',
  carrier: 'neutral',
};

const KIND_ICON: Record<EmitterKind, typeof Radio> = {
  whisperwave: Antenna,
  chirp: TrendingUp,
  pulsed: CircleDot,
  harmonic: Layers,
  broadband: Waves,
  carrier: Radio,
};

/**
 * The scanner tab.
 *
 * A wideband view of everything the microphone can hear, with each persistent
 * signal identified and, when one of them turns out to be a WhisperWave
 * carrier, handed straight to the demodulator.
 */
export function ScannerPanel() {
  const { frame, scanning, start, stop, tuneTo, bands } = useSpectrumScanner();
  const scanMode = useStore((s) => s.scanMode);
  const setScanMode = useStore((s) => s.setScanMode);
  const squelchDb = useStore((s) => s.squelchDb);
  const setSquelchDb = useStore((s) => s.setSquelchDb);
  const autoLock = useStore((s) => s.autoLock);
  const setAutoLock = useStore((s) => s.setAutoLock);
  const lockedBy = useStore((s) => s.lockedBy);
  const sampleRate = useStore((s) => s.sampleRate);
  const listening = useStore((s) => s.listening);

  const summary = frame?.summary ?? null;
  const tracks = frame?.tracks ?? [];
  const carrier = frame?.carrier ?? null;
  const nyquist = sampleRate / 2;

  // One transmission fragments into many peaks in the FFT, so a band that is
  // carrying WhisperWave is listed once, as its strongest fragment.
  const visible = useMemo(() => {
    const seenProfiles = new Set<string>();
    const rows: EmitterTrack[] = [];
    for (const t of tracks) {
      if (t.snrDb < squelchDb - 2) continue;
      if (t.kind === 'whisperwave' && t.profileId) {
        if (seenProfiles.has(t.profileId)) continue;
        seenProfiles.add(t.profileId);
      }
      rows.push(t);
      if (rows.length >= 12) break;
    }
    return rows;
  }, [tracks, squelchDb]);

  const pickChannel = (index: number) => {
    spectrumScanner.selectChannel(index);
    setScanMode('hold');
  };

  return (
    <Panel highlight={scanning} cornerMarks>
      <PanelTitle
        icon={<Radar className="h-4 w-4" />}
        hint={scanning ? `0 – ${(nyquist / 1000).toFixed(1)} kHz LIVE` : 'IDLE'}
      >
        Ambient Spectrum Scanner
      </PanelTitle>

      <div className="mb-4">
        <Button
          variant={scanning ? 'ghost' : 'accent'}
          size="lg"
          onClick={() => (scanning ? stop() : void start())}
          icon={scanning ? <ScanLine className="h-5 w-5 text-rose-400" /> : <Radar className="h-5 w-5" />}
          scanline={!scanning}
          className={`w-full text-base font-black uppercase tracking-wider ${
            scanning ? 'border-rose-500/30 text-rose-200 hover:border-rose-500/60' : 'neon-glow-lg'
          }`}
        >
          {scanning ? 'STOP SCANNING' : 'SCAN SURROUNDINGS'}
        </Button>
      </div>

      <BandScope bands={bands} active={scanning} onPickChannel={pickChannel} />

      {/* Sweep control: the FFT sees everything at once, so this steers the
          scope's attention rather than any hardware tuner. */}
      <div className="mt-4 space-y-2.5">
        <Segmented
          ariaLabel="Scan mode"
          value={scanMode}
          onChange={setScanMode}
          options={[
            { value: 'wide', label: 'Wide span', icon: <Waves className="h-3.5 w-3.5" /> },
            { value: 'sweep', label: 'Auto sweep', icon: <ScanLine className="h-3.5 w-3.5" /> },
            { value: 'hold', label: 'Hold band', icon: <Crosshair className="h-3.5 w-3.5" /> },
          ]}
        />

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                frame?.holding ? 'bg-amber-400 animate-pulse' : scanning ? 'accent-bg' : 'bg-white/25'
              }`}
            />
            <div className="min-w-0">
              <div className="truncate text-[0.7rem] font-bold text-white/85">
                {frame?.channel && scanMode !== 'wide' ? frame.channel.name : 'Full span'}
              </div>
              <div className="num truncate text-[0.6rem] text-white/45">
                {frame?.channel && scanMode !== 'wide'
                  ? `${fmtHz(frame.channel.low)} – ${fmtHz(frame.channel.high)}${frame.holding ? ' · squelch hold' : ''}`
                  : `0 Hz – ${fmtHz(nyquist)} · every band at once`}
              </div>
            </div>
          </div>

          <Slider
            label="Squelch"
            icon={<Gauge className="h-3.5 w-3.5" />}
            value={squelchDb}
            min={4}
            max={26}
            step={1}
            onChange={setSquelchDb}
            format={(v) => `${v} dB over floor`}
          />
        </div>

        <Toggle
          label="Auto-lock to WhisperWave carriers"
          hint="Retune the receiver and start decoding when a carrier holds in a profile band"
          icon={<Zap className="h-3.5 w-3.5" />}
          checked={autoLock}
          onChange={setAutoLock}
        />
      </div>

      {/* Carrier lock: the scan-to-decode hand-off, made visible. */}
      {carrier && (
        <div className="mt-2.5 flex items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3">
          <Antenna className="h-5 w-5 shrink-0 animate-pulse text-amber-300" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black uppercase tracking-wider text-amber-200">
              WhisperWave carrier · {carrier.profileName}
            </div>
            <div className="num mt-0.5 truncate text-[0.65rem] text-amber-100/75">
              {fmtHz(carrier.freq)} · {carrier.snrDb.toFixed(0)} dB over floor ·{' '}
              {Math.round(carrier.occupancy * 100)}% of band lit · held {(carrier.heldMs / 1000).toFixed(1)} s
            </div>
          </div>
          <Button
            size="sm"
            variant={lockedBy === carrier.profileId && listening ? 'ghost' : 'accent'}
            onClick={() => void tuneTo(carrier.profileId as ProfileId)}
          >
            {lockedBy === carrier.profileId && listening ? 'Decoding' : 'Tune'}
          </Button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Occupancy"
          value={summary ? (summary.occupancy * 100).toFixed(1) : '—'}
          unit="%"
        />
        <Stat
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Noise Floor"
          value={summary ? summary.noiseFloorDb.toFixed(0) : '—'}
          unit="dBFS"
        />
        <Stat
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Emitters"
          value={scanning ? visible.length : '—'}
          unit="tracked"
        />
        <Stat
          icon={<Crosshair className="h-3.5 w-3.5" />}
          label="Strongest"
          value={summary && scanning ? (summary.peakFreq / 1000).toFixed(2) : '—'}
          unit="kHz"
        />
      </div>

      {/* Room read-out in words, for when the numbers are not the point. */}
      {scanning && summary && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={summary.voiceSnrDb > 4 ? 'success' : 'neutral'} icon={<Volume2 className="h-3 w-3" />}>
            {summary.voiceSnrDb > 4 ? 'Speech band active' : 'Speech band quiet'}
          </Badge>
          <Badge tone={summary.ultrasonicSnrDb > 3 ? 'warn' : 'neutral'} icon={<Antenna className="h-3 w-3" />}>
            {summary.ultrasonicSnrDb > 3 ? 'Ultrasonic activity' : 'Ultrasonic clear'}
          </Badge>
          <Badge tone={summary.occupancy > 0.12 ? 'danger' : 'neutral'} icon={<Waves className="h-3 w-3" />}>
            {summary.occupancy > 0.12 ? 'Congested band' : 'Band mostly clear'}
          </Badge>
        </div>
      )}

      {/* Emitter list */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-white/55">
            Identified emitters
          </h3>
          {scanning && (
            <span className="num text-[0.62rem] text-white/40">{visible.length} above squelch</span>
          )}
        </div>

        {!scanning ? (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-white/50">
            The scanner watches the whole audible and near-ultrasonic spectrum at once, tracks every signal that
            persists, and names what it is likely to be — mains hum, a beacon, a sweep, a room full of speech, or a
            WhisperWave carrier it can hand straight to the receiver.
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs text-white/45">
            Nothing is breaking squelch. Lower the squelch to see further into the noise.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((t) => (
              <EmitterRow key={t.id} track={t} squelchDb={squelchDb} onTune={tuneTo} />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-[0.68rem] leading-relaxed text-white/45">
        <strong className="text-white/70">What this can and cannot hear:</strong> browsers reach the microphone and
        nothing else, so this is the acoustic spectrum — 0 to {(nyquist / 1000).toFixed(1)} kHz — not radio. Radio is
        still reachable second-hand: feed an SDR or scanner's demodulated audio into this device's line-in and every
        emitter in that audio is tracked, classified and translated here exactly like a sound in the room.
      </p>
    </Panel>
  );
}

function EmitterRow({
  track,
  squelchDb,
  onTune,
}: {
  track: EmitterTrack;
  squelchDb: number;
  onTune: (id: ProfileId) => void;
}) {
  const Icon = KIND_ICON[track.kind];
  const strength = Math.max(0, Math.min(1, (track.snrDb - squelchDb) / 34));
  const ageSeconds = Math.max(0, (track.lastSeen - track.firstSeen) / 1000);
  const profile = track.profileId ? PROFILES[track.profileId as ProfileId] : undefined;

  return (
    <li
      className={`rounded-xl border p-2.5 transition-colors ${
        track.kind === 'whisperwave'
          ? 'border-amber-400/35 bg-amber-400/[0.07]'
          : track.present
          ? 'border-white/[0.09] bg-white/[0.03]'
          : 'border-white/[0.05] bg-white/[0.015] opacity-60'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40 accent-text">
          <Icon className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num text-sm font-black text-white">{fmtHz(track.freq)}</span>
            <Badge tone={KIND_TONE[track.kind]}>{track.label}</Badge>
            <span className="num text-[0.62rem] font-bold text-white/45">
              +{track.snrDb.toFixed(0)} dB
            </span>
          </div>

          <p className="mt-1 text-[0.68rem] leading-relaxed text-white/55">{track.detail}</p>

          <div className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6rem] text-white/40">
            <span>{track.band.name}</span>
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {ageSeconds < 1 ? 'new' : `${ageSeconds.toFixed(0)}s`}
            </span>
            <span>duty {Math.round(track.dutyCycle * 100)}%</span>
            <span>bw {fmtHz(track.bandwidth)}</span>
            {Math.abs(track.driftHzPerSec) > 40 && (
              <span>{track.driftHzPerSec > 0 ? '↑' : '↓'} {Math.abs(Math.round(track.driftHzPerSec))} Hz/s</span>
            )}
          </div>

          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.max(4, strength * 100)}%`,
                background: track.kind === 'whisperwave' ? '#f59e0b' : 'var(--accent)',
              }}
            />
          </div>
        </div>

        {profile && (
          <Button size="sm" variant="secondary" onClick={() => onTune(profile.id)} className="shrink-0">
            Decode
          </Button>
        )}
      </div>
    </li>
  );
}
