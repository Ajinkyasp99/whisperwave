import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import type { RadioParams } from '../dsp/profiles';

/**
 * Live spectrum over the active band, with a waterfall underneath.
 *
 * The view is cropped to the band in use plus a margin rather than showing the
 * whole 0-24 kHz: at long range the signal is a few dB above the floor, and at
 * full scale that is a single invisible pixel. Cropping is what makes "am I
 * actually being heard" answerable by looking.
 */
export function Spectrum({ params, active }: { params: RadioParams; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    // Slow-moving estimate of the quietest visible bin. The waterfall is scaled
    // against this rather than against absolute dBFS: microphone gain varies by
    // tens of dB between devices, and a fixed mapping either saturates to a
    // solid block or shows nothing at all.
    let floorRef = 0.35;
    let wasActive = false;

    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#22d3ee';

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        waterfallRef.current = null;
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      resize();

      const w = canvas.width;
      const h = canvas.height;
      const specH = Math.round(h * 0.46);
      const fallH = h - specH;

      // Clear only the spectrum strip: the waterfall below *is* the history
      // buffer, and wiping it before scrolling would leave it permanently blank.
      ctx.fillStyle = '#080b14';
      ctx.fillRect(0, 0, w, specH);

      const analyser = engine.spectrumAnalyser;
      if (!analyser || !active) {
        wasActive = false;
        ctx.fillRect(0, specH, w, fallH);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = `${Math.round(11 * (window.devicePixelRatio || 1))}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText('microphone off', w / 2, h / 2);
        return;
      }

      if (!bytes || bytes.length !== analyser.frequencyBinCount) {
        bytes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(bytes);

      if (!wasActive) {
        // Wipe the history so the "microphone off" placeholder does not scroll
        // down through the new trace.
        ctx.fillRect(0, specH, w, fallH);
        wasActive = true;
      }

      // Map the cropped frequency window onto the canvas width.
      const nyquist = engine.sampleRate / 2;
      const margin = (params.bandHigh - params.bandLow) * 0.75;
      const lo = Math.max(0, params.bandLow - margin);
      const hi = Math.min(nyquist, params.bandHigh + margin);
      const binOf = (f: number) => Math.round((f / nyquist) * bytes!.length);

      let quietest = 1;
      for (let x = 0; x < w; x += 2) {
        const f = lo + ((hi - lo) * x) / w;
        const v = bytes[Math.min(bytes.length - 1, binOf(f))] / 255;
        if (v < quietest) quietest = v;
      }
      floorRef = floorRef * 0.92 + quietest * 0.08;
      const span = Math.max(0.16, 1 - floorRef - 0.04);

      const xOf = (f: number) => ((f - lo) / (hi - lo)) * w;

      // Clip to the spectrum strip. The trace's antialiased stroke otherwise
      // bleeds a row into the waterfall, and since the waterfall scrolls itself
      // that stray row is copied down forever, washing the whole history out.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, specH);
      ctx.clip();

      // Band-of-interest backdrop.
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(xOf(params.bandLow), 0, xOf(params.bandHigh) - xOf(params.bandLow), specH);

      // Spectrum trace.
      ctx.beginPath();
      ctx.moveTo(0, specH);
      for (let x = 0; x < w; x++) {
        const f = lo + ((hi - lo) * x) / w;
        const b = Math.min(bytes.length - 1, binOf(f));
        const v = bytes[b] / 255;
        ctx.lineTo(x, specH - v * (specH - 2));
      }
      ctx.lineTo(w, specH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, specH);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.8);
      ctx.stroke();
      ctx.restore();

      // Waterfall: shift down one row, paint the newest row on top.
      if (fallH > 2) {
        const prev = ctx.getImageData(0, specH, w, fallH - 1);
        ctx.putImageData(prev, 0, specH + 1);
        const row = ctx.createImageData(w, 1);
        for (let x = 0; x < w; x++) {
          const f = lo + ((hi - lo) * x) / w;
          const v = bytes[Math.min(bytes.length - 1, binOf(f))] / 255;
          // Subtract the measured floor and curve: an empty room reads as
          // black, so the moment a chirp arrives it is unmistakable.
          const t = Math.min(1, Math.max(0, (v - floorRef - 0.04) / span) ** 1.5);
          const i = x * 4;
          if (t < 0.5) {
            const u = t * 2;
            row.data[i] = 8 + u * 12;
            row.data[i + 1] = 11 + u * 99;
            row.data[i + 2] = 20 + u * 130;
          } else {
            const u = (t - 0.5) * 2;
            row.data[i] = 20 + u * 215;
            row.data[i + 1] = 110 + u * 135;
            row.data[i + 2] = 150 + u * 105;
          }
          row.data[i + 3] = 255;
        }
        ctx.putImageData(row, 0, specH);
      }

      // Band edges, over the spectrum only so the waterfall stays readable.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      for (const f of [params.bandLow, params.bandHigh]) {
        const x = Math.round(xOf(f)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, specH);
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [params, active]);

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="h-40 w-full rounded-xl border border-white/8 sm:h-52" />
      <div className="num pointer-events-none absolute inset-x-2 bottom-1 flex justify-between text-[0.6rem] text-white/35">
        <span>{((params.bandLow - (params.bandHigh - params.bandLow) * 0.75) / 1000).toFixed(1)} kHz</span>
        <span className="accent-text">
          {(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz
        </span>
        <span>{((params.bandHigh + (params.bandHigh - params.bandLow) * 0.75) / 1000).toFixed(1)} kHz</span>
      </div>
    </div>
  );
}
