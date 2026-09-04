import { useState } from 'react';
import { PROFILES } from '../dsp/profiles';
import { useStore, type Received } from '../store/useStore';
import { Button, Panel, PanelTitle } from './ui';
import {
  Copy,
  Check,
  Share2,
  Printer,
  Trash2,
  Download,
  Search,
  Radio,
  FileText,
} from 'lucide-react';

function timeOf(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function Row({ m }: { m: Received }) {
  const [copied, setCopied] = useState(false);
  const profile = PROFILES[m.profileId];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text: m.text });
      } catch {
        /* dismissed */
      }
    }
  };

  const downloadMessage = () => {
    const blob = new Blob([m.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whisperwave-frame-${m.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <li
      data-accent={profile.accent}
      className="panel-tight corner-mark corner-mark-tl corner-mark-br border border-white/12 bg-[#091020]/90 p-4 transition-all duration-200 hover:bg-[#0e172e] hover:border-white/25 shadow-lg"
    >
      {/* Frame Metadata Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5 text-[0.68rem] text-white/50">
        <div className="flex items-center gap-2">
          <span className="num font-extrabold text-white/90 bg-white/[0.06] px-2 py-0.5 rounded border border-white/10">
            {timeOf(m.at)}
          </span>
          <span className="accent-text font-black uppercase tracking-wider">
            {profile.name}
          </span>
          {m.snrDb > -50 && (
            <span className="num font-extrabold text-cyan-300">
              +{m.snrDb.toFixed(1)} dB SNR
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="num rounded bg-white/[0.06] px-2 py-0.5 font-bold text-white/75 border border-white/10">
            {m.payloadBytes} B
          </span>
          {m.correctedBytes > 0 ? (
            <span
              className="num rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 font-extrabold text-amber-300"
              title="Byte errors reconstructed by Reed-Solomon codec"
            >
              Repaired {m.correctedBytes} B {m.erasuresUsed ? `(${m.erasuresUsed} flagged)` : ''}
            </span>
          ) : (
            <span className="num rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-0.5 font-extrabold text-emerald-300">
              Clean · 0 Errors
            </span>
          )}
        </div>
      </div>

      {/* Message Decoded Text Payload */}
      <div className="mt-2.5 text-sm sm:text-base font-semibold leading-relaxed text-white selection:bg-cyan-500/40 break-words font-sans">
        {m.text}
      </div>

      {/* Action Bar */}
      <div className="no-print mt-3 flex flex-wrap items-center gap-1.5 sm:gap-2 border-t border-white/[0.06] pt-2.5">
        <Button
          size="sm"
          onClick={copy}
          icon={copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>

        {canShare && (
          <Button size="sm" onClick={share} icon={<Share2 className="h-3.5 w-3.5" />}>
            Share
          </Button>
        )}

        <Button size="sm" onClick={downloadMessage} icon={<Download className="h-3.5 w-3.5" />}>
          Export
        </Button>
      </div>
    </li>
  );
}

export function MessageLog({ className = '' }: { className?: string } = {}) {
  const { messages, clearMessages, searchQuery, setSearchQuery } = useStore();

  const filteredMessages = messages.filter((m) =>
    searchQuery ? m.text.toLowerCase().includes(searchQuery.toLowerCase()) : true
  );

  const exportAllJson = () => {
    const data = JSON.stringify(messages, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whisperwave-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel cornerMarks className={`w-full ${className}`}>
      <PanelTitle
        icon={<FileText className="h-4 w-4" />}
        hint={messages.length ? `${messages.length} FRAMES DECODED` : undefined}
      >
        Verified Message Stream
      </PanelTitle>

      {messages.length > 0 && (
        <div className="mb-3.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter decoded frames…"
              className="w-full rounded-xl border border-white/12 bg-black/40 py-2 pl-9 pr-3 text-sm sm:text-xs text-white placeholder:text-white/35 focus:border-cyan-400/50 focus:outline-none"
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs font-bold text-white/60 hover:text-white transition p-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <div className="relative mb-3 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/15 shadow-xl">
            <Radio className="h-6 w-6 sm:h-7 sm:w-7 accent-text" />
            <span className="ping-ring absolute inset-0 rounded-2xl border border-white/20 opacity-40" />
          </div>
          <h3 className="text-sm sm:text-base font-extrabold text-white">Listening for Incoming Acoustic Frames</h3>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-white/50">
            Transmissions are automatically captured, demodulated via FFT matched filters, repaired with Reed–Solomon FEC, and verified by CRC-16.
          </p>
        </div>
      ) : filteredMessages.length === 0 ? (
        <p className="py-8 text-center text-xs font-semibold text-white/45">
          No frames match "{searchQuery}".
        </p>
      ) : (
        <>
          <ul className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
            {filteredMessages.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </ul>

          <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <Button size="sm" onClick={() => window.print()} icon={<Printer className="h-3.5 w-3.5" />}>
                Print Receipt
              </Button>
              <Button size="sm" onClick={exportAllJson} icon={<Download className="h-3.5 w-3.5" />}>
                Export JSON
              </Button>
            </div>

            <Button
              size="sm"
              variant="danger"
              onClick={clearMessages}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Clear Feed
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
