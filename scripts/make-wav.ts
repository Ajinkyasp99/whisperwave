/** Render a transmission to a 16-bit WAV so Chrome can replay it as a fake microphone. */
import { writeFileSync } from 'node:fs';
import { PROFILES, deriveParams, type ProfileId } from '../src/dsp/profiles';
import { renderTransmission } from '../src/dsp/modulator';

const id = (process.argv[2] || 'stealth') as ProfileId;
const text = process.argv[3] || 'hello from the air';
const out = process.argv[4] || 'fake-mic.wav';
const rate = Number(process.argv[5] || 48000);

const params = deriveParams(PROFILES[id], rate);
const tx = renderTransmission(new TextEncoder().encode(text), params, { volume: 0.85, drive: 1 });

// Lead-in silence so the receiver settles its noise floor before the preamble,
// plus a tail so Chrome's looping does not butt frames together.
const lead = Math.round(1.0 * rate);
const tail = Math.round(1.0 * rate);
const total = lead + tx.samples.length + tail;

const bytes = Buffer.alloc(44 + total * 2);
bytes.write('RIFF', 0);
bytes.writeUInt32LE(36 + total * 2, 4);
bytes.write('WAVEfmt ', 8);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);
bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(rate, 24);
bytes.writeUInt32LE(rate * 2, 28);
bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(total * 2, 40);

for (let i = 0; i < total; i++) {
  const s = i >= lead && i < lead + tx.samples.length ? tx.samples[i - lead] : 0;
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
}
writeFileSync(out, bytes);
console.log(`${out}: ${id} "${text}" ${(total / rate).toFixed(1)}s @ ${rate} Hz`);
