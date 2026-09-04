import { Modal, Badge } from './ui';
import { engine } from '../audio/engine';
import { useStore } from '../store/useStore';
import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';

export function DiagnosticsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { sampleRate, listening, phase, snrDb, noiseDb, level } = useStore();
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;
  const hasWorklet = typeof AudioWorklet !== 'undefined';
  const hasMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const micReport = engine.micReport;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Audio & Hardware Diagnostics" icon={<Activity className="h-5 w-5" />}>
      <div className="space-y-5 text-sm">
        {/* Environment Status */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">System & Security Context</h4>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <span className="text-white/60">Secure Origin (HTTPS/localhost):</span>
              {isSecure ? (
                <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Secure</Badge>
              ) : (
                <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>Insecure</Badge>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <span className="text-white/60">AudioWorklet DSP Node:</span>
              {hasWorklet ? (
                <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Supported</Badge>
              ) : (
                <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Unavailable</Badge>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <span className="text-white/60">MediaDevices API:</span>
              {hasMedia ? (
                <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Available</Badge>
              ) : (
                <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Blocked</Badge>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <span className="text-white/60">Hardware Sample Rate:</span>
              <span className="num font-bold text-cyan-300">{(sampleRate / 1000).toFixed(1)} kHz</span>
            </div>
          </div>
        </div>

        {/* Live Audio Engine Metrics */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">Live Receiver Telemetry</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">Receiver State</div>
              <div className="num mt-1 font-semibold text-white/90">{listening ? phase : 'Offline'}</div>
            </div>

            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">Processing SNR Margin</div>
              <div className="num mt-1 font-semibold text-cyan-300">
                {Number.isFinite(snrDb) && snrDb > -50 ? `${snrDb.toFixed(1)} dB` : '—'}
              </div>
            </div>

            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">Estimated Noise Floor</div>
              <div className="num mt-1 font-semibold text-white/70">
                {Number.isFinite(noiseDb) && noiseDb > -50 ? `${noiseDb.toFixed(1)} dBFS` : '—'}
              </div>
            </div>

            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">RMS Mic Level</div>
              <div className="num mt-1 font-semibold text-emerald-300">
                {listening ? `${(20 * Math.log10(Math.max(level, 1e-6))).toFixed(1)} dBFS` : '—'}
              </div>
            </div>

            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">Microphone Track</div>
              <div className="truncate mt-1 text-xs text-white/80">
                {micReport?.label || (listening ? 'Active Track' : 'Uninitialized')}
              </div>
            </div>

            <div className="rounded-lg bg-black/30 p-2.5 border border-white/[0.05]">
              <div className="text-[0.65rem] text-white/40 uppercase">Voice Processing Filter</div>
              <div className="mt-1 text-xs font-medium text-emerald-300">
                {micReport?.echoCancellation || micReport?.noiseSuppression ? 'Warning: Active' : 'Bypassed (Clean)'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
