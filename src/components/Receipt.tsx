import { PROFILES, deriveParams } from '../dsp/profiles';
import { useStore } from '../store/useStore';

/**
 * Print-only transcript. Hidden on screen; `window.print()` hides the app
 * chrome and lays this out on clean white paper instead.
 */
export function Receipt() {
  const { messages, sampleRate } = useStore();
  if (messages.length === 0) return null;

  return (
    <div className="print-only font-mono" style={{ color: '#000', padding: '24px 0', maxWidth: '680px', margin: '0 auto' }}>
      <div style={{ borderBottom: '2px solid #000', paddingBottom: '12px', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', margin: 0, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          WHISPERWAVE // ACOUSTIC TRANSCRIPT RECEIPT
        </h1>
        <div style={{ fontSize: '10px', marginTop: '6px', color: '#444', display: 'flex', justifyContent: 'space-between' }}>
          <span>TIMESTAMP: {new Date().toLocaleString()}</span>
          <span>DEVICE DSP: {(sampleRate / 1000).toFixed(1)} kHz</span>
          <span>INTEGRITY: CRC-16 + RS(GF256)</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages
          .slice()
          .reverse()
          .map((m, idx) => {
            const profile = PROFILES[m.profileId];
            const params = deriveParams(profile, sampleRate);
            return (
              <div key={m.id} style={{ borderBottom: '1px dashed #bbb', paddingBottom: '12px' }}>
                <div style={{ fontSize: '10px', color: '#555', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>
                    #{String(idx + 1).padStart(3, '0')} · {new Date(m.at).toLocaleTimeString()} · {profile.name.toUpperCase()} ({(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz)
                  </span>
                  <span>
                    {m.payloadBytes} B · {m.snrDb > -50 ? `+${m.snrDb.toFixed(1)} dB SNR · ` : ''}
                    {m.correctedBytes > 0 ? `REPAIRED ${m.correctedBytes}B` : 'CLEAN'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 600, color: '#111' }}>
                  {m.text}
                </div>
              </div>
            );
          })}
      </div>

      <div style={{ marginTop: '20px', borderTop: '1px solid #000', paddingTop: '8px', fontSize: '9px', color: '#666', textAlign: 'center' }}>
        *** END OF TRANSMISSION LOG · VERIFIED PHYSICAL LAYER FRAME RECEIPT ***
      </div>
    </div>
  );
}
