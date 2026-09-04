import { useEffect } from 'react';
import { engine } from '../audio/engine';
import { PROFILES } from '../dsp/profiles';
import { useStore } from '../store/useStore';

/** Wire the audio engine's callbacks into the store, once, for the app's life. */
export function useEngineBridge() {
  useEffect(() => {
    const s = useStore.getState();
    engine.cb = {
      onMetrics: (m) => useStore.getState().setMetrics(m),
      onProgress: (p) => useStore.getState().setProgress(p),
      onNotice: (t) => useStore.getState().setNotice(t),
      onTransmitProgress: (f) => {
        useStore.getState().setTxProgress(f);
        if (f >= 1) useStore.getState().setTransmitting(false);
      },
      onMessage: (m) => {
        useStore.getState().addMessage(m);
        // A short buzz is the only feedback that works when the phone is
        // across the room and the profile is inaudible.
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([18, 40, 18]);
      },
    };
    s.setSampleRate(engine.sampleRate);
    return () => {
      engine.cb = {};
    };
  }, []);

  // Retuning must not drop the microphone, or the browser re-prompts.
  const profileId = useStore((st) => st.profileId);
  const listening = useStore((st) => st.listening);
  useEffect(() => {
    if (listening) engine.retune(PROFILES[profileId]);
  }, [profileId, listening]);

  useEffect(() => () => engine.dispose(), []);
}
