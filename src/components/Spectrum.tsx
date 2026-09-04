import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import type { RadioParams } from '../dsp/profiles';
import { Activity } from 'lucide-react';

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
    let floorRef = 0.35;
    let wasActive = false;

    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#06b6d4';

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

      // Dark background fill
      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, w, specH);

      const analyser = engine.spectrumAnalyser;
      if (!analyser || !active) {
        wasActive = false;
        ctx.fillRect(0, specH, w, fallH);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `600 ${Math.round(11 * (window.devicePixelRatio || 1))}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('MICROPHONE INACTIVE · CLICK START LISTENING', w / 2, h / 2);
        return;
      }

      if (!bytes || bytes.length !== analyser.frequencyBinCount) {
        bytes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(bytes);

      if (!wasActive) {
        ctx.fillRect(0, specH, w, fallH);
        wasActive = true;
      }

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

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, specH);
      ctx.clip();

      // Band-of-interest highlighted background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(xOf(params.bandLow), 0, xOf(params.bandHigh) - xOf(params.bandLow), specH);

      // Subtle horizontal grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let y = 0.25; y <= 0.75; y += 0.25) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(specH * y) + 0.5);
        ctx.lineTo(w, Math.round(specH * y) + 0.5);
        ctx.stroke();
      }

      // Spectrum trace
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
      grad.addColorStop(0.7, 'rgba(6, 182, 212, 0.2)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.2, (window.devicePixelRatio || 1) * 0.9);
      ctx.stroke();
      ctx.restore();

      // Waterfall rendering: shift downward
      if (fallH > 2) {
        const prev = ctx.getImageData(0, specH, w, fallH - 1);
        ctx.putImageData(prev, 0, specH + 1);
        const row = ctx.createImageData(w, 1);
        for (let x = 0; x < w; x++) {
          const f = lo + ((hi - lo) * x) / w;
          const v = bytes[Math.min(bytes.length - 1, binOf(f))] / 255;
          const t = Math.min(1, Math.max(0, (v - floorRef - 0.04) / span) ** 1.5);
          const i = x * 4;

          if (t < 0.35) {
            const u = t / 0.35;
            row.data[i] = 5 + u * 15;
            row.data[i + 1] = 10 + u * 40;
            row.data[i + 2] = 25 + u * 120;
          } else if (t < 0.7) {
            const u = (t - 0.35) / 0.35;
            row.data[i] = 20 + u * 40;
            row.data[i + 1] = 50 + u * 150;
            row.data[i + 2] = 145 + u * 60;
          } else {
            const u = (t - 0.7) / 0.3;
            row.data[i] = 60 + u * 195;
            row.data[i + 1] = 200 + u * 55;
            row.data[i + 2] = 205 + u * 50;
          }
          row.data[i + 3] = 255;
        }
        ctx.putImageData(row, 0, specH);
      }

      // Band edge boundary lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
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

  const loFreq = (params.bandLow - (params.bandHigh - params.bandLow) * 0.75) / 1000;
  const hiFreq = (params.bandHigh + (params.bandHigh - params.bandLow) * 0.75) / 1000;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90 shadow-inner">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[0.58rem] sm:text-[0.62rem] font-bold uppercase tracking-wider text-white/70 backdrop-blur-md border border-white/10">
        <Activity className="h-3 w-3 accent-text" />
        <span>Live Waterfall & FFT</span>
      </div>

      <canvas ref={canvasRef} className="h-36 sm:h-52 w-full block" />

      <div className="num pointer-events-none absolute inset-x-2.5 bottom-1.5 flex justify-between text-[0.6rem] sm:text-[0.65rem] font-semibold text-white/50">
        <span>{loFreq.toFixed(1)}k</span>
        <span className="accent-text font-black rounded bg-black/70 px-1.5 py-0.2 border border-white/10">
          {(params.bandLow / 1000).toFixed(1)}–{(params.bandHigh / 1000).toFixed(1)} kHz
        </span>
        <span>{hiFreq.toFixed(1)}k</span>
      </div>
    </div>
  );
}
