import { PROFILES, deriveParams } from '../dsp/profiles';
import { useStore } from '../store/useStore';

/**
 * Print-only transcript. Hidden on screen; `window.print()` hides the app
 * chrome and lays this out on white instead.
 */
export function Receipt() {
  const { messages, sampleRate } = useStore();
  if (messages.length === 0) return null;

  return (
    <div className="print-only" style={{ color: '#000', padding: '16px 0' }}>
      <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>WhisperWave — received transcript</h1>
      <p style={{ fontSize: 11, margin: '4px 0 16px', color: '#555' }}>
        Printed {new Date().toLocaleString()} · device sample rate {(sampleRate / 1000).toFixed(1)} kHz ·
        every entry verified by CRC-16 after Reed-Solomon correction
      </p>

      {messages
        .slice()
        .reverse()
        .map((m) => {
          const profile = PROFILES[m.profileId];
          const params = deriveParams(profile, sampleRate);
          return (
            <div key={m.id} style={{ borderTop: '1px solid #ddd', padding: '10px 0' }}>
              <div style={{ fontSize: 10, color: '#666', fontFamily: 'ui-monospace, monospace' }}>
                {new Date(m.at).toLocaleString()} · {profile.name} ·{' '}
                {(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz ·{' '}
                {m.payloadBytes} bytes ·{' '}
                {m.snrDb > -50 ? `${m.snrDb.toFixed(1)} dB margin · ` : ''}
                {m.correctedBytes > 0 ? `${m.correctedBytes} byte(s) repaired` : 'no errors'}
              </div>
              <div style={{ fontSize: 14, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.text}
              </div>
            </div>
          );
        })}
    </div>
  );
}
