import { Modal, Badge } from './ui';
import { BookOpen, Languages, Radar, Radio, Shield, Smartphone, Volume2 } from 'lucide-react';

export function GuideModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="How WhisperWave Works" icon={<BookOpen className="h-5 w-5" />}>
      <div className="space-y-6 text-sm text-white/80">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="flex items-center gap-2 text-base font-semibold text-white">
            <Radio className="h-4 w-4 accent-text" /> Data Through Soundwaves
          </h4>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/70">
            WhisperWave transmits digital bytes through sound using <strong>Chirp Spread Spectrum (CSS)</strong> and{' '}
            <strong>Reed–Solomon Error Correction</strong>. No Wi-Fi, no Bluetooth, no pairing or local network
            connection is required — only a speaker on one device and a microphone on the other.
          </p>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-white/50">Transmission Profiles</h4>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-violet-300">Ghost (18.2–19.8 kHz)</span>
                <Badge tone="accent">Silent</Badge>
              </div>
              <p className="mt-1.5 text-xs text-white/60">
                Completely silent to human ears. Perfect for covert transfers across a desk (1–3 m).
              </p>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-300">Stealth (17.2–19.6 kHz)</span>
                <Badge tone="accent">Ultrasonic</Badge>
              </div>
              <p className="mt-1.5 text-xs text-white/60">
                Inaudible to most adults with higher bandwidth. Reliable up to 6 meters.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-300">Balanced (8–14 kHz)</span>
                <Badge tone="success">Airy Hiss</Badge>
              </div>
              <p className="mt-1.5 text-xs text-white/60">
                Soft audible hiss that pierces background chatter, reaching 4–10 meters at 328 b/s.
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-300">Long Range (2–6 kHz)</span>
                <Badge tone="warn">Max Distance</Badge>
              </div>
              <p className="mt-1.5 text-xs text-white/60">
                Audible chirps with heavy spreading factor (SF8) designed to cross rooms and hallways (8–20+ m).
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="flex items-center gap-2 text-base font-semibold text-white">
            <Radar className="h-4 w-4 accent-text" /> Scanning the Room
          </h4>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/70">
            The <strong>Scan</strong> tab sweeps everything the microphone can hear — 0 Hz to half the sample rate —
            and tracks each signal that persists, naming what it is likely to be from how it behaves: a steady
            carrier, a duty-cycled beacon, a sweep, a harmonic stack or broadband noise. When a band lights up the way
            a WhisperWave transmission does, the scanner retunes the receiver to that profile and starts decoding on
            its own, so you never have to know which profile the other end chose.
          </p>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/70">
            It is an <strong>acoustic</strong> scanner: browsers reach the microphone and nothing else. Radio is still
            reachable second-hand — feed an SDR or scanner's demodulated audio into this device's line-in and every
            emitter in it is tracked here like a sound in the room.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="flex items-center gap-2 text-base font-semibold text-white">
            <Languages className="h-4 w-4 accent-text" /> Any Language, On the Fly
          </h4>
          <p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/70">
            Frames carry UTF-8, so the other end can send any language. Each one is identified as it lands — from its
            writing system and its function words, entirely offline — and rendered in the language you chose. Where
            the browser offers an on-device translation model, the translation happens locally and nothing leaves the
            device; where it does not, the language is still named and the original is shown unchanged rather than
            being sent to some server.
          </p>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-white/50">Best Practices & Tips</h4>
          <div className="space-y-2 text-xs text-white/70">
            <div className="flex items-start gap-2.5 rounded-lg bg-white/[0.02] p-2.5 border border-white/[0.05]">
              <Volume2 className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
              <div>
                <strong className="text-white">Device Volume:</strong> Turn the transmitting device volume up to 80–100%. Aim the speaker toward the receiving device microphone.
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg bg-white/[0.02] p-2.5 border border-white/[0.05]">
              <Smartphone className="h-4 w-4 shrink-0 text-violet-400 mt-0.5" />
              <div>
                <strong className="text-white">Phone-to-Phone Setup:</strong> Run <code className="num text-cyan-300">pnpm dev:https</code> on your laptop and open the displayed LAN address on both phones over HTTPS.
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg bg-white/[0.02] p-2.5 border border-white/[0.05]">
              <Shield className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <div>
                <strong className="text-white">Zero False Positives:</strong> Frames require full Reed-Solomon convergence AND a CRC-16 checksum match. Room noise is mathematically prevented from turning into text.
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
