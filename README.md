# WhisperWave

Send text between two devices as sound. No Wi-Fi, no Bluetooth, no pairing — just a
speaker and a microphone, entirely in the browser.

Two of the four profiles are **inaudible**: they sit at 17–20 kHz, above adult hearing.
The other two trade stealth for distance, reaching across a large room or hallway.

```
pnpm install
pnpm dev            # http://localhost:5173
pnpm test           # 31 DSP tests, headless
pnpm test:browser   # end-to-end in real Chrome with a synthetic microphone
```

To try it phone-to-phone, run `pnpm dev:https` and open the LAN address on both
devices. Browsers only expose the microphone in a secure context, and `localhost`
is the only plaintext exception.

## Profiles

| Profile | Band | Audibility | Range | Rate |
|---|---|---|---|---|
| **Ghost** | 18.2–19.8 kHz | silent to human ears | 1–3 m | 150 b/s |
| **Stealth** | 17.2–19.6 kHz | inaudible to most adults | 2–6 m | 225 b/s |
| **Balanced** | 8–14 kHz | a soft airy hiss | 4–10 m | 328 b/s |
| **Long Range** | 2–6 kHz | clearly audible chirps | 8–20 m+ | 125 b/s |

Bands snap to the device sample rate, so the exact figures shift slightly between
44.1 and 48 kHz. Both ends derive them identically and never negotiate.

## How the distance is won

Loudness is not the lever — browser volume is capped and phone speakers are small.
Range comes from processing gain and error correction instead.

**Chirp spread spectrum.** A symbol is a linear chirp sweeping the whole band,
cyclically shifted by the value it carries. The receiver multiplies by the conjugate
base chirp, which collapses the sweep to a single FFT bin. That correlation is worth
10·log10(N) dB — 18 to 24 dB here — so a chirp still decodes when it is well *below*
the noise floor. Chirps also shrug off echoes: a reflection arrives as a separate
peak at a different bin rather than fading the signal out.

**Matched-filter acquisition, multipath aware.** The preamble is found by correlating
against the known chirp. A reverberant room delivers each preamble chirp several
times, so the detector tracks candidate propagation paths by their phase modulo the
symbol clock and locks onto the strongest, instead of demanding one strictly periodic
run of peaks.

**Sub-chip timing recovery.** One chip is one FFT bin, so half a chip of leftover
propagation delay smears every symbol between two bins. The receiver measures the
residual from the preamble by directly maximising the DTFT over a fine grid, then
slides the decimator's *sampling instants* onto the transmitter's chip grid. Two
crystals also differ by tens of ppm, which drags the grid more than a whole chip
across a long frame, so a PI loop tracks the drift rate for the rest of the frame.

**Pilot symbols.** A known chirp every 16 symbols. The timing loop can only observe
the *fractional* bin offset — the argmax hides whole bins — so it is equally stable
locked one bin off, and a noise transient near the half-bin boundary makes it re-lock
there for a long stretch. A pilot must decode to a known bin, so whatever bin it lands
on *is* the integer offset, and data is corrected against the pilots bracketing it.

**Reed–Solomon with erasures.** Payloads carry 16–32 parity bytes over GF(256),
repairing `parity/2` unknown byte errors. The demodulator also scores each symbol by
how far the winning bin beat its nearest rival, and hands the doubtful ones to the
decoder as erasures — which cost half as much, doubling what a frame can survive.

**Band-limited transmit.** The waveform is built as the ideal chip-rate baseband
sequence and sinc-interpolated up to the sample rate. Integrating a wrapped
frequency law directly at the output rate is easier but produces a *different*,
discontinuous signal: a receiver sampling a fraction of a chip off picks up a phase
step partway through each symbol, splitting the peak. That alone cost ~6 dB on half
of all arrival phases.

**Zero false positives.** A frame is printed only after Reed–Solomon converges *and*
a CRC-16 over the payload matches. Thirty seconds of room noise per profile produces
nothing, which the test suite asserts.

## Scanning the room

The **Scan** tab is a wideband receiver for everything else in the air. A
high-resolution FFT over the raw microphone covers 0 Hz to Nyquist, every signal that
persists is tracked frame to frame, and each track is named from how it behaves rather
than from where it sits: a steady carrier, a duty-cycled beacon, a sweep, an overtone
of something lower, or broadband noise. Mains hum, a smoke alarm's chirp, an ultrasonic
motion sensor and a WhisperWave transmission all read differently, and the panel says
which is which in words.

**The floor is estimated across frequency, not across time.** A temporal average slowly
swallows any continuous carrier — exactly the signal a scanner exists to find. Each
block of bins contributes a low percentile, and those anchors are then pooled across a
neighbourhood of blocks, because a spread-spectrum signal is far wider than one block
and would otherwise become its own noise floor and vanish.

**Carriers are found by band occupancy, not by peaks.** A chirp sweeps its whole band
inside one symbol, so over an FFT window it appears as a rippling plateau that
fragments into a dozen unrelated-looking spikes. What identifies it is that most of one
profile's band is lit, spread across its full width, and that the band is well above
the spectrum either side of it — compared in dB, because a loud audible transmission
splatters weak energy over its neighbours and would defeat any comparison of occupied
*fractions*. Broadband noise lights every band equally and is rejected on the same test.

**Scan to decode.** When a carrier holds in a profile's band for about a second, the
scanner retunes the receiver to that profile and starts decoding — so neither end has
to know in advance which profile the other chose. The sweep mode steps the scope
through the named bands and parks wherever the squelch breaks, the way a scanner radio
dwells on a busy channel.

It is an *acoustic* scanner: browsers reach the microphone and nothing else. Radio is
still reachable second-hand — feed an SDR's demodulated audio into the device's line-in
and every emitter in it is tracked, classified and translated here like a sound in the
room.

## Any language, on the fly

Frames carry UTF-8, so the other end can send any language. Each decoded frame — and,
where the browser offers speech recognition, the room's own speech — is identified as
it arrives and rendered in the language you chose.

Identification is offline and needs no model: the writing system pins most languages
outright, marker words and letters separate the ones that share a script (Hindi from
Marathi from Nepali, Russian from Ukrainian from Serbian, Arabic from Urdu from
Persian), and Latin script falls back to function-word scoring. Translation uses the
browser's *on-device* Translator when it exists, so nothing leaves the device; when it
does not, the language is still named and the original is shown unchanged rather than
being posted to someone's API.

## Measured behaviour

`pnpm test` simulates the full path — path loss, multipath, crystal offset, AWGN,
arrival phase — through the real modulator and the real AudioWorklet DSP:

- every profile decodes at **−12 dB** broadband SNR under heavy multipath; Long Range
  reaches **−18 dB**
- 30/30 conditions per profile across ±60 ppm clock offset, both common sample rates,
  and arrival phases spread across the chip
- 30 s of room noise per profile decodes nothing
- Reed–Solomon repairs its full error budget and refuses beyond it
- the scanner's floor estimator survives a 50 dB carrier and a 30 dB tilt, plants no
  false alarms in pure noise, and keeps a 2.4 kHz spread carrier visible
- carrier detection fires on a fragmented chirp, and refuses a hand clap, a single
  whistle inside the band, and silence
- 20 languages are identified from decoded text without a network

`pnpm test:browser` renders a transmission to a WAV, feeds it to headless Chrome as a
fake microphone, drives the real UI and waits for the text to appear — exercising the
AudioWorklet, the audio graph and React together.

## Layout

```
public/ww-demod.worklet.js   physical layer: mix, decimate, correlate, de-chirp, FFT
src/dsp/
  profiles.ts                bands, spreading factors, device-snapped parameters
  modulator.ts               band-limited CSS transmitter
  chirp.ts                   reference chirps and the decimating filter
  pilots.ts                  pilot layout and integer-offset correction
  frame.ts                   header/payload framing, RS + CRC
  reedSolomon.ts, gf256.ts   errors-and-erasures codec over GF(256)
  bits.ts, crc.ts            Gray-coded symbol packing, checksums
  spectrumScan.ts            noise floor, peak detection, carrier decision
  emitters.ts                emitter tracking and classification
src/audio/
  engine.ts                  AudioContext, transmit and receive graphs
  frameAssembler.ts          link layer: symbols to verified messages
  hardwareConfig.ts          microphone constraints
  spectrumScanner.ts         wideband scan loop, sweep, carrier hand-off
src/i18n/
  detect.ts                  offline language identification
  translate.ts               on-device Translator bridge, with honest fallbacks
src/components/              UI, spectrum/waterfall, band scope, printable receipt
```

The worklet is plain JavaScript served straight from `public/` so it loads
identically in dev and production, and it holds only the physical layer — a slow
Reed–Solomon decode on the main thread can never underrun the audio buffer. It also
exports its DSP core on `globalThis`, which is how the test suite drives the real
demodulator head-less.

## Notes

- Voice processing is explicitly disabled on the microphone. Echo cancellation, noise
  suppression and AGC all classify a distant chirp as noise and delete it; the app
  warns if a browser keeps them on anyway.
- Power boost (soft clipping, ~2 dB more in-band for the same peak excursion) is
  disabled on the inaudible profiles, where the harmonics would fold back under
  Nyquist into the audible range.
- Screen wake lock is held during transfers, since a sleeping phone suspends its
  audio graph mid-frame.
- Longest message is 237 bytes — one Reed–Solomon codeword.
