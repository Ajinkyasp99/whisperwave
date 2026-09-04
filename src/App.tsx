import { PROFILES } from './dsp/profiles';
import { useEngineBridge } from './hooks/useEngineBridge';
import { useWakeLock } from './hooks/useWakeLock';
import { useStore, type Tab } from './store/useStore';
import { LinkFacts } from './components/LinkFacts';
import { ListenPanel } from './components/ListenPanel';
import { MessageLog } from './components/MessageLog';
import { ProfilePicker } from './components/ProfilePicker';
import { Receipt } from './components/Receipt';
import { SendPanel } from './components/SendPanel';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'send', label: 'Send' },
  { id: 'listen', label: 'Listen' },
  { id: 'log', label: 'Messages' },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative z-0 flex h-9 w-9 shrink-0 items-center justify-center">
        <span
          className="ping-ring absolute inset-0 rounded-full border"
          style={{ borderColor: 'var(--accent)' }}
          aria-hidden
        />
        <span
          className="ping-ring ping-ring-2 absolute inset-0 rounded-full border"
          style={{ borderColor: 'var(--accent)' }}
          aria-hidden
        />
        <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 12h2l1.6-4 2 9L9.4 4l2 12L13 8.5l1.6 5L16 12h6" />
        </svg>
      </span>
      <div className="relative z-10 leading-tight">
        <div className="text-[0.95rem] font-semibold tracking-tight">WhisperWave</div>
        <div className="text-[0.65rem] text-white/40">data through the air, no networks</div>
      </div>
    </div>
  );
}

function Banner({ tone, text, onDismiss }: { tone: 'error' | 'notice'; text: string; onDismiss: () => void }) {
  const cls =
    tone === 'error'
      ? 'border-rose-400/25 bg-rose-500/12 text-rose-100'
      : 'border-amber-300/25 bg-amber-400/10 text-amber-100';
  return (
    <div className={`no-print flex items-start gap-3 rounded-xl border p-3 text-sm ${cls}`}>
      <p className="flex-1 leading-snug">{text}</p>
      <button type="button" onClick={onDismiss} className="no-tap shrink-0 text-xs opacity-60 hover:opacity-100">
        Dismiss
      </button>
    </div>
  );
}

export default function App() {
  useEngineBridge();

  const { profileId, tab, setTab, listening, transmitting, error, notice, setError, setNotice, messages } = useStore();
  useWakeLock(listening || transmitting);

  const accent = PROFILES[profileId].accent;

  return (
    <div data-accent={accent} className="min-h-full">
      <div className="mx-auto w-full max-w-6xl px-4 pb-28 lg:pb-10">
        <header className="safe-t no-print sticky top-0 z-20 -mx-4 mb-4 bg-[#05070f]/80 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <Logo />
            <div className="flex items-center gap-2 text-[0.68rem]">
              <span
                className={`h-2 w-2 rounded-full ${listening ? 'animate-pulse' : ''}`}
                style={{ background: listening ? 'var(--accent)' : 'rgba(255,255,255,0.2)' }}
                aria-hidden
              />
              <span className="text-white/45">{listening ? 'listening' : 'mic off'}</span>
            </div>
          </div>
        </header>

        <div className="space-y-4">
          {error ? <Banner tone="error" text={error} onDismiss={() => setError(null)} /> : null}
          {notice ? <Banner tone="notice" text={notice} onDismiss={() => setNotice(null)} /> : null}

          <div className="no-print">
            <ProfilePicker />
          </div>

          {/* Desktop: everything at once. Mobile: one panel per tab.
              Printing replaces all of it with the receipt below. */}
          <div className="no-print hidden gap-4 lg:grid lg:grid-cols-2">
            <div className="space-y-4">
              <SendPanel />
              <LinkFacts />
            </div>
            <div className="space-y-4">
              <ListenPanel />
              <MessageLog />
            </div>
          </div>

          <div className="no-print space-y-4 lg:hidden">
            {tab === 'send' ? (
              <>
                <SendPanel />
                <LinkFacts />
              </>
            ) : null}
            {tab === 'listen' ? <ListenPanel /> : null}
            {tab === 'log' ? <MessageLog /> : null}
          </div>

          <Receipt />

          <footer className="no-print pt-2 text-center text-[0.65rem] leading-relaxed text-white/25">
            Chirp spread spectrum · Reed-Solomon FEC · CRC-verified. Works offline, between any two devices with a
            speaker and a microphone.
          </footer>
        </div>
      </div>

      <nav className="no-print safe-b fixed inset-x-0 bottom-0 z-30 border-t border-white/8 bg-[#05070f]/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-6xl">
          {TABS.map((t) => {
            const active = tab === t.id;
            const badge = t.id === 'log' && messages.length > 0 ? messages.length : null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className="no-tap relative flex-1 py-3 text-[0.78rem] font-medium transition"
                style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.45)' }}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-6 top-0 h-[2px] rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                ) : null}
                {t.label}
                {badge ? (
                  <span className="num ml-1 rounded-full bg-white/12 px-1.5 py-0.5 text-[0.6rem] text-white/70">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
