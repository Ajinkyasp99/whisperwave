import { useEffect } from 'react';

type Sentinel = { release: () => Promise<void>; released: boolean };

/**
 * Hold the screen awake while a transfer is in flight.
 *
 * A phone that sleeps mid-transmission suspends its audio graph, which on a
 * 20 second long-range frame is the difference between a delivered message and
 * a truncated one.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;

    let sentinel: Sentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) void s.release();
        else sentinel = s;
      } catch {
        /* denied or unsupported; nothing we can do */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}
