/**
 * Receiving needs a secure origin; transmitting does not.
 *
 * Browsers expose `navigator.mediaDevices` and `AudioWorklet` only in a secure
 * context, and `localhost` is the sole plaintext exception. So the app works
 * perfectly on the machine serving it and then appears broken the moment you
 * open the same URL on a phone over the LAN - which is exactly the setup this
 * app exists for. Detect it up front and say so, rather than letting an
 * undefined property surface as a TypeError.
 */

export interface ContextCheck {
  ok: boolean;
  reason?: string;
  /** The same page over HTTPS, when that is what is missing. */
  suggestedUrl?: string;
}

export function checkReceiveSupport(): ContextCheck {
  if (typeof window === 'undefined') return { ok: false, reason: 'No browser environment.' };

  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'This browser does not expose a microphone API.' };
  }

  if (typeof AudioWorklet === 'undefined') {
    return { ok: false, reason: 'This browser has no AudioWorklet support, which the demodulator needs.' };
  }

  return { ok: true };
}
