import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { spectrumScanner, type ScanFrame } from '../audio/spectrumScanner';
import type { ProfileBand } from '../dsp/emitters';
import { PROFILES, PROFILE_ORDER, deriveParams, type ProfileId } from '../dsp/profiles';
import { useStore } from '../store/useStore';

/** Sustained presence required before the scanner retunes the receiver. */
const LOCK_AFTER_MS = 900;
/** Minimum spacing between automatic retunes, so two live bands cannot thrash. */
const LOCK_COOLDOWN_MS = 8000;

/**
 * Drives the ambient scanner and the scan-to-decode hand-off.
 *
 * Frames arrive several times a second; they are kept in local state rather
 * than the store so nothing outside this tab re-renders at scan rate.
 */
export function useSpectrumScanner() {
  const scanning = useStore((s) => s.scanning);
  const setScanning = useStore((s) => s.setScanning);
  const scanMode = useStore((s) => s.scanMode);
  const squelchDb = useStore((s) => s.squelchDb);
  const autoLock = useStore((s) => s.autoLock);
  const setLockedBy = useStore((s) => s.setLockedBy);
  const profileId = useStore((s) => s.profileId);
  const setProfile = useStore((s) => s.setProfile);
  const listening = useStore((s) => s.listening);
  const setListening = useStore((s) => s.setListening);
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  const setSampleRate = useStore((s) => s.setSampleRate);
  const sampleRate = useStore((s) => s.sampleRate);

  const [frame, setFrame] = useState<ScanFrame | null>(null);
  const lastLockAt = useRef(0);

  const bands = useMemo<ProfileBand[]>(
    () =>
      PROFILE_ORDER.map((id) => {
        const params = deriveParams(PROFILES[id], sampleRate);
        return { id, name: PROFILES[id].name, low: params.bandLow, high: params.bandHigh };
      }),
    [sampleRate],
  );

  useEffect(() => spectrumScanner.onFrame(setFrame), []);
  useEffect(() => spectrumScanner.setSquelchDb(squelchDb), [squelchDb]);
  useEffect(() => spectrumScanner.setMode(scanMode), [scanMode]);
  useEffect(() => spectrumScanner.setProfileBands(bands), [bands]);

  const start = useCallback(async () => {
    try {
      setError(null);
      await engine.startScanning(bands);
      spectrumScanner.setSquelchDb(squelchDb);
      spectrumScanner.setMode(scanMode);
      setSampleRate(engine.sampleRate);
      setScanning(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /denied|NotAllowed/i.test(msg)
          ? 'Microphone access was denied, so the spectrum cannot be scanned.'
          : `Could not open the microphone: ${msg}`,
      );
    }
  }, [bands, scanMode, squelchDb, setError, setSampleRate, setScanning]);

  const stop = useCallback(() => {
    engine.stopScanning();
    setScanning(false);
    setFrame(null);
  }, [setScanning]);

  useEffect(() => () => engine.stopScanning(), []);

  /**
   * Scan-to-decode: a WhisperWave carrier that holds in one profile's band
   * retunes the receiver to that profile and, if nothing is listening yet,
   * starts the demodulator. This is the whole point of the scanner - you no
   * longer have to know which profile the other end chose.
   */
  const carrier = frame?.carrier ?? null;
  useEffect(() => {
    if (!autoLock || !scanning || !carrier) return;
    if (carrier.heldMs < LOCK_AFTER_MS) return;
    const now = Date.now();
    if (now - lastLockAt.current < LOCK_COOLDOWN_MS) return;

    const target = carrier.profileId as ProfileId;
    if (!PROFILES[target]) return;
    const alreadyTuned = target === profileId;
    if (alreadyTuned && listening) return;

    lastLockAt.current = now;
    if (!alreadyTuned) setProfile(target);
    setLockedBy(target);

    if (!listening) {
      void engine
        .startListening(PROFILES[target])
        .then(() => {
          setListening(true);
          setNotice(`Carrier locked in the ${PROFILES[target].name} band - decoding automatically.`);
        })
        .catch(() => {
          setNotice(`Carrier detected in the ${PROFILES[target].name} band. Start the receiver to decode it.`);
        });
    } else {
      setNotice(`Carrier locked - receiver retuned to ${PROFILES[target].name}.`);
    }
  }, [autoLock, scanning, carrier, profileId, listening, setProfile, setLockedBy, setListening, setNotice]);

  /** Manual version of the same hand-off, from a row in the emitter list. */
  const tuneTo = useCallback(
    async (id: ProfileId) => {
      setProfile(id);
      setLockedBy(id);
      lastLockAt.current = Date.now();
      if (!listening) {
        try {
          await engine.startListening(PROFILES[id]);
          setListening(true);
        } catch {
          setError('Could not start the receiver.');
        }
      }
    },
    [listening, setProfile, setLockedBy, setListening, setError],
  );

  return { frame, scanning, start, stop, tuneTo, bands };
}
