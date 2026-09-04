/**
 * Play a subtle high-tech acoustic chirp/blip upon message receipt.
 */
let chimeCtx: AudioContext | null = null;

export function playReceiptChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!chimeCtx || chimeCtx.state === 'closed') {
      chimeCtx = new Ctor();
    }
    if (chimeCtx.state === 'suspended') {
      chimeCtx.resume();
    }

    const now = chimeCtx.currentTime;
    const osc = chimeCtx.createOscillator();
    const gain = chimeCtx.createGain();

    osc.type = 'sine';
    // Gentle dual-tone ascending chirp
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // A6

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(chimeCtx.destination);

    osc.start(now);
    osc.stop(now + 0.23);
  } catch {
    // AudioContext blocked or not supported
  }
}
