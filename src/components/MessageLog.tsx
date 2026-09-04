import { useState } from 'react';
import { PROFILES } from '../dsp/profiles';
import { useStore, type Received } from '../store/useStore';
import { Button, Panel, PanelTitle } from './ui';

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
      setTimeout(() => setCopied(false), 1400);
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

  return (
    <li data-accent={profile.accent} className="panel-tight border border-white/8 bg-white/[0.025] p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem] text-white/40">
        <span className="num">{timeOf(m.at)}</span>
        <span className="accent-text">{profile.name}</span>
        <span className="num">{m.snrDb > -50 ? `${m.snrDb.toFixed(0)} dB` : ''}</span>
        <span className="num">{m.payloadBytes} B</span>
        {m.correctedBytes > 0 ? (
          <span className="num text-amber-300/70" title="Bytes rebuilt by Reed-Solomon">
            repaired {m.correctedBytes}
            {m.erasuresUsed ? ` (${m.erasuresUsed} flagged)` : ''}
          </span>
        ) : (
          <span className="num text-emerald-300/60">clean</span>
        )}
      </div>
      <p className="mt-1.5 break-words text-[0.95rem] leading-snug text-white/90">{m.text}</p>
      <div className="no-print mt-2 flex gap-2">
        <Button onClick={copy} className="!min-h-[2rem] !px-2.5 !text-xs">
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {canShare ? (
          <Button onClick={share} className="!min-h-[2rem] !px-2.5 !text-xs">
            Share
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function MessageLog() {
  const { messages, clearMessages } = useStore();

  return (
    <Panel>
      <PanelTitle hint={messages.length ? `${messages.length} received` : undefined}>Decoded messages</PanelTitle>

      {messages.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/35">
          Nothing decoded yet. Every message is checked against a CRC before it appears here, so noise never
          becomes text.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {messages.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </ul>
          <div className="no-print mt-4 flex gap-2">
            <Button onClick={() => window.print()}>Print receipt</Button>
            <Button onClick={clearMessages}>Clear</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
