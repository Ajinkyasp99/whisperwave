import { useEffect, useRef } from 'react';
import { spectrumScanner } from '../audio/spectrumScanner';
import type { ProfileBand } from '../dsp/emitters';
import { Radar } from 'lucide-react';

/**
 * Panoramic scope for the ambient scanner.
 *
 * Unlike the transceiver's Spectrum, which crops hard to the profile in use,
 * this one shows the whole span the microphone can hear - and animates its
 * window when the sweep steps between bands. Everything is drawn against the
 * measured noise floor rather than full scale, because a 12 dB carrier at
 * -70 dBFS is invisible on an absolute scale and is exactly what the scanner
 * is looking for.
 */
export function BandScope({
  bands,
  active,
  onPickChannel,
}: {
  bands: ProfileBand[];
  active: boolean;
  onPickChannel?: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let topDb = -30;
    let botDb = -110;

    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#06b6d4';
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = dpr();
      const w = Math.max(1, Math.floor(canvas.clientWidth * r));
      const h = Math.max(1, Math.floor(canvas.clientHeight * r));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      // Hidden behind a CSS breakpoint or an inactive tab: nothing to paint.
      if (!canvas.clientWidth) return;
      resize();

      const w = canvas.width;
      const h = canvas.height;
      const specH = Math.round(h * 0.55);
      const fallH = h - specH;
      const px = dpr();

      ctx.fillStyle = '#050a14';
      ctx.fillRect(0, 0, w, specH);

      const spec = spectrumScanner.spectrumDb;
      const floor = spectrumScanner.floorDb;
      const binHz = spectrumScanner.binHz;

      if (!active || !spec || !floor || !binHz) {
        ctx.fillRect(0, specH, w, fallH);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `600 ${Math.round(11 * px)}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('SCANNER IDLE · START THE SWEEP TO SEE THE ROOM', w / 2, h / 2);
        return;
      }

      const { lo, hi } = spectrumScanner.view;
      const span = Math.max(1, hi - lo);
      const xOf = (f: number) => ((f - lo) / span) * w;
      const binOf = (f: number) => Math.max(0, Math.min(spec.length - 1, Math.round(f / binHz)));

      // Vertical scale follows the floor and the loudest thing on screen, so
      // the trace fills the box whether the room is silent or a siren.
      let peak = -160;
      let floorSum = 0;
      let counted = 0;
      for (let x = 0; x < w; x += 2) {
        const b = binOf(lo + (span * x) / w);
        const v = spec[b];
        if (Number.isFinite(v) && v > peak) peak = v;
        floorSum += floor[b];
        counted++;
      }
      const floorAvg = counted ? floorSum / counted : -120;
      topDb += (Math.max(peak + 6, floorAvg + 24) - topDb) * 0.08;
      botDb += (floorAvg - 10 - botDb) * 0.08;
      const yOf = (db: number) => specH - ((db - botDb) / Math.max(6, topDb - botDb)) * (specH - 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, specH);
      ctx.clip();

      // WhisperWave profile bands, so their occupancy is readable at a glance.
      // Ghost sits inside Stealth, so the names are staggered over two rows -
      // side by side they collide into an unreadable smear.
      ctx.font = `700 ${Math.round(8.5 * px)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      let bandRow = 0;
      for (const b of bandsRef.current) {
        const x0 = xOf(b.low);
        const x1 = xOf(b.high);
        if (x1 < 0 || x0 > w) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), specH);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x0) + 0.5, 0);
        ctx.lineTo(Math.round(x0) + 0.5, specH);
        ctx.moveTo(Math.round(x1) + 0.5, 0);
        ctx.lineTo(Math.round(x1) + 0.5, specH);
        ctx.stroke();
        ctx.setLineDash([]);
        // Below the corner chip, so the two never collide.
        if (x1 - x0 > 34 * px) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText(b.name.toUpperCase(), x0 + 3 * px, (bandRow % 2 === 0 ? 30 : 41) * px);
          bandRow++;
        }
      }

      // Squelch line: everything above it is a detection.
      const squelch = spectrumScanner.squelch;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = 0; x < w; x += 3) {
        const y = yOf(floor[binOf(lo + (span * x) / w)] + squelch);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Noise floor.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      for (let x = 0; x < w; x += 3) {
        const y = yOf(floor[binOf(lo + (span * x) / w)]);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Live trace.
      ctx.beginPath();
      ctx.moveTo(0, specH);
      for (let x = 0; x < w; x++) {
        const v = spec[binOf(lo + (span * x) / w)];
        ctx.lineTo(x, yOf(Number.isFinite(v) ? v : botDb));
      }
      ctx.lineTo(w, specH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, specH);
      grad.addColorStop(0, accent);
      grad.addColorStop(0.75, 'rgba(6,182,212,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0.01)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.1, px * 0.85);
      ctx.stroke();

      // Emitter markers, strongest first. Labels are dropped rather than
      // overprinted when two emitters land within a label's width of each
      // other - a pile of unreadable digits is worse than no number.
      const tracks = spectrumScanner.tracks.slice(0, 7);
      const labelled: Array<{ from: number; to: number }> = [];
      ctx.font = `700 ${Math.round(9 * px)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      for (const t of tracks) {
        const x = xOf(t.freq);
        if (x < 0 || x > w) continue;
        const isWave = t.kind === 'whisperwave';
        const color = isWave ? '#f59e0b' : t.present ? '#e2e8f0' : 'rgba(226,232,240,0.35)';
        const y = yOf(t.levelDb);
        ctx.strokeStyle = color;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.moveTo(x, Math.max(0, y - 12 * px));
        ctx.lineTo(x, Math.min(specH, y + 4 * px));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * px, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        const label = t.freq >= 1000 ? `${(t.freq / 1000).toFixed(2)}k` : `${Math.round(t.freq)}`;
        const half = ctx.measureText(label).width / 2 + 3 * px;
        const box = { from: x - half, to: x + half };
        if (labelled.some((l) => box.from < l.to && box.to > l.from)) continue;
        labelled.push(box);
        ctx.fillStyle = color;
        ctx.fillText(label, x, Math.max(9 * px, y - 15 * px));
      }
      ctx.restore();

      /* --------------------------- waterfall --------------------------- */
      if (fallH > 2) {
        const prev = ctx.getImageData(0, specH, w, fallH - 1);
        ctx.putImageData(prev, 0, specH + 1);
        const row = ctx.createImageData(w, 1);
        for (let x = 0; x < w; x++) {
          const b = binOf(lo + (span * x) / w);
          const excess = (Number.isFinite(spec[b]) ? spec[b] : -160) - floor[b];
          const t = Math.max(0, Math.min(1, excess / 42)) ** 1.35;
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

      /* ------------------------- frequency axis ------------------------- */
      const steps = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
      const step = steps.find((s) => span / s <= 8) ?? 10000;
      ctx.font = `600 ${Math.round(8.5 * px)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      for (let f = Math.ceil(lo / step) * step; f <= hi; f += step) {
        const x = xOf(f);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, specH);
        ctx.lineTo(Math.round(x) + 0.5, specH + 4 * px);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
        ctx.fillText(label, x, specH + 13 * px);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPickChannel || !spectrumScanner.active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { lo, hi } = spectrumScanner.view;
    const freq = lo + ((e.clientX - rect.left) / rect.width) * (hi - lo);
    const index = spectrumScanner.channelList.findIndex((c) => freq >= c.low && freq < c.high);
    if (index >= 0) onPickChannel(index);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/90 shadow-inner">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2 py-0.5 text-[0.58rem] sm:text-[0.62rem] font-bold uppercase tracking-wider text-white/70 backdrop-blur-md">
        <Radar className="h-3 w-3 accent-text" />
        <span>Panoramic Band Scope</span>
      </div>
      <canvas
        ref={canvasRef}
        onClick={pick}
        title="Tap a band to park the sweep on it"
        className="block h-52 w-full cursor-crosshair sm:h-64"
      />
    </div>
  );
}
