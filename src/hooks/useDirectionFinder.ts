import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { spatialAnalyzer, type DirectionOfArrivalResult } from '../audio/directionFinder';

export function useDirectionFinder() {
  const {
    listening,
    soundBearing,
    soundConfidence,
    compassHeading,
    setSoundDirection,
    setCompassHeading,
  } = useStore();

  const [compassSupported, setCompassSupported] = useState(false);
  const [compassActive, setCompassActive] = useState(false);
  const [isStereo, setIsStereo] = useState(false);

  // Subscribe to Spatial Audio Direction of Arrival updates
  useEffect(() => {
    const unsub = spatialAnalyzer.onDirection((res: DirectionOfArrivalResult) => {
      setSoundDirection(res.bearing, res.confidence);
      setIsStereo(res.isStereo);
    });
    return unsub;
  }, [setSoundDirection]);

  // Handle Device Orientation / Compass Heading
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasOrientation = 'DeviceOrientationEvent' in window;
    setCompassSupported(hasOrientation);

    const handleOrientation = (e: DeviceOrientationEvent) => {
      // iOS WebKit compass heading (0 = North, 90 = East, 180 = South, 270 = West)
      let heading: number | null = null;
      if ('webkitCompassHeading' in e && typeof (e as unknown as { webkitCompassHeading: number }).webkitCompassHeading === 'number') {
        heading = (e as unknown as { webkitCompassHeading: number }).webkitCompassHeading;
      } else if (e.alpha !== null && e.alpha !== undefined) {
        // Android / standard alpha heading
        heading = (360 - e.alpha) % 360;
      }

      if (heading !== null) {
        setCompassHeading(Math.round(heading));
        spatialAnalyzer.setCompassHeading(heading);
        setCompassActive(true);
      }
    };

    if (hasOrientation) {
      window.addEventListener('deviceorientation', handleOrientation, true);
      window.addEventListener('deviceorientationabsolute' as unknown as string, handleOrientation as unknown as EventListener, true);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('deviceorientationabsolute' as unknown as string, handleOrientation as unknown as EventListener, true);
    };
  }, [setCompassHeading]);

  // Request Permission for iOS Safari (requires user gesture)
  const requestCompassPermission = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      'DeviceOrientationEvent' in window &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }).requestPermission === 'function'
    ) {
      try {
        const response = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<'granted' | 'denied'> }).requestPermission();
        if (response === 'granted') {
          setCompassActive(true);
          return true;
        }
      } catch (err) {
        console.warn('Compass permission rejected:', err);
      }
    }
    return false;
  }, []);

  return {
    bearing: soundBearing,
    confidence: soundConfidence,
    compassHeading,
    compassSupported,
    compassActive,
    isStereo,
    listening,
    requestCompassPermission,
  };
}
