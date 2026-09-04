/**
 * Microphone constraints.
 *
 * Every one of these is off for a reason. Browsers assume a microphone is
 * carrying a human voice, so by default they run echo cancellation, noise
 * suppression and automatic gain control - and to all three of those, a faint
 * chirp arriving from across the room is textbook background noise. Left on,
 * they delete exactly the signal we came for, and the further away the
 * transmitter is the more thoroughly they delete it.
 */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    // Legacy Chromium goog* aliases: still honoured by some Android builds
    // that ignore the standard properties above.
    ...({
      googEchoCancellation: false,
      googAutoGainControl: false,
      googNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
    } as Record<string, boolean>),
  } as MediaTrackConstraints,
  video: false,
};

export interface MicReport {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  label?: string;
}

/** What the browser actually granted, which is not always what we asked for. */
export function describeTrack(track: MediaStreamTrack): MicReport {
  const settings = track.getSettings() as MediaTrackSettings & {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  };
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    sampleRate: settings.sampleRate,
    label: track.label,
  };
}
