import { PROFILES } from './dsp/profiles';
import { useEngineBridge } from './hooks/useEngineBridge';
import { useWakeLock } from './hooks/useWakeLock';
import { useStore, type Tab } from './store/useStore';
import { Header } from './components/Header';
import { GuideModal } from './components/GuideModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { LinkFacts } from './components/LinkFacts';
import { ListenPanel } from './components/ListenPanel';
import { MessageLog } from './components/MessageLog';
import { ProfilePicker } from './components/ProfilePicker';
import { Receipt } from './components/Receipt';
import { SendPanel } from './components/SendPanel';
import {
  Send,
  Mic,
  MessageSquare,
  AlertTriangle,
  Info,
  X,
  Radio,
} from 'lucide-react';

const TABS: Array<{ id: Tab; label: string; icon: typeof Send }> = [
  { id: 'transceiver', label: 'Transceiver', icon: Radio },
  { id: 'send', label: 'Transmit', icon: Send },
  { id: 'listen', label: 'Receive', icon: Mic },
  { id: 'log', label: 'Messages', icon: MessageSquare },
];

function Banner({
  tone,
  text,
  onDismiss,
}: {
  tone: 'error' | 'notice';
  text: string;
  onDismiss: () => void;
}) {
  const isError = tone === 'error';
  const cls = isError
    ? 'border-rose-500/40 bg-rose-500/15 text-rose-100 shadow-[0_0_25px_-5px_rgba(244,63,94,0.4)]'
    : 'border-amber-400/40 bg-amber-400/15 text-amber-100 shadow-[0_0_25px_-5px_rgba(251,191,36,0.4)]';

  return (
    <div
      className={`no-print flex items-start gap-3 rounded-2xl border p-3.5 sm:p-4 text-xs sm:text-sm backdrop-blur-2xl transition-all ${cls}`}
    >
      {isError ? (
        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
      ) : (
        <Info className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
      )}
      <p className="flex-1 leading-relaxed font-medium">{text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss banner"
        className="no-tap shrink-0 rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white transition"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function App() {
  useEngineBridge();

  const {
    profileId,
    tab,
    setTab,
    listening,
    transmitting,
    error,
    notice,
    setError,
    setNotice,
    messages,
    activeModal,
    setActiveModal,
  } = useStore();

  useWakeLock(listening || transmitting);

  const accent = PROFILES[profileId].accent;

  return (
    <div data-accent={accent} className="min-h-full flex flex-col justify-between">
      <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 pb-32 sm:pb-36 lg:pb-12">
        <Header />

        <div className="space-y-4 sm:space-y-5">
          {error && <Banner tone="error" text={error} onDismiss={() => setError(null)} />}
          {notice && <Banner tone="notice" text={notice} onDismiss={() => setNotice(null)} />}

          <div className="no-print">
            <ProfilePicker />
          </div>

          {/* Desktop Dual-Column Instrumentation Grid */}
          <div className="no-print hidden gap-5 lg:grid lg:grid-cols-2">
            <div className="space-y-5">
              <SendPanel />
              <LinkFacts />
            </div>
            <div className="space-y-5">
              <ListenPanel />
              <MessageLog />
            </div>
          </div>

          {/* Mobile Tabbed Views */}
          <div className="no-print space-y-4 sm:space-y-5 lg:hidden">
            {tab === 'transceiver' && (
              <>
                <SendPanel />
                <ListenPanel />
                <LinkFacts />
              </>
            )}
            {tab === 'send' && (
              <>
                <SendPanel />
                <LinkFacts />
              </>
            )}
            {tab === 'listen' && (
              <>
                <ListenPanel />
                <LinkFacts />
              </>
            )}
            {tab === 'log' && <MessageLog />}
          </div>

          <Receipt />

          <footer className="no-print pt-6 sm:pt-8 pb-3 text-center text-[0.68rem] sm:text-[0.7rem] leading-relaxed text-white/40">
            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-semibold uppercase tracking-wider">
              <span className="accent-text">Chirp Spread Spectrum (CSS)</span>
              <span>·</span>
              <span className="text-white/70">Reed–Solomon FEC (GF256)</span>
              <span>·</span>
              <span className="text-white/70">CRC-16 Integrity</span>
              <span>·</span>
              <span className="text-emerald-400">Zero Network Dependency</span>
            </div>
            <div className="mt-1.5 text-[0.62rem] sm:text-[0.65rem] text-white/30">
              WhisperWave transmits digital bytes through sound using physical acoustic correlation.
            </div>
          </footer>
        </div>
      </div>

      {/* Stitch Mobile Floating Glassmorphic Bottom Navigation Bar */}
      <nav className="no-print safe-b fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-sm sm:max-w-md z-50 rounded-full bg-[#070e1e]/90 backdrop-blur-2xl border border-cyan-500/30 shadow-[0_8px_32px_rgba(0,0,0,0.85),0_0_20px_rgba(6,182,212,0.15)] lg:hidden p-1.5 flex justify-around items-center">
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          const badge = t.id === 'log' && messages.length > 0 ? messages.length : null;

          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={`no-tap relative flex flex-1 flex-col items-center justify-center py-1.5 text-xs font-bold transition-all duration-200 active:scale-95 rounded-full ${
                active ? 'text-white' : 'text-white/45 hover:text-white/75'
              }`}
            >
              {active && (
                <div
                  className="absolute inset-0 rounded-full bg-white/[0.08] border border-white/20 neon-glow -z-10"
                  style={{
                    borderColor: 'var(--accent)',
                  }}
                />
              )}
              <div className="relative">
                <Icon
                  className="h-4 w-4 sm:h-5 sm:w-5 mb-0.5"
                  style={{ color: active ? 'var(--accent)' : undefined }}
                />
                {badge && (
                  <span className="num absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[0.55rem] font-black text-slate-950 shadow-md">
                    {badge}
                  </span>
                )}
              </div>
              <span
                className="text-[0.62rem] sm:text-[0.68rem] tracking-wider uppercase"
                style={{ color: active ? 'var(--accent)' : undefined }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Interactive Modals */}
      <GuideModal
        isOpen={activeModal === 'guide'}
        onClose={() => setActiveModal(null)}
      />
      <DiagnosticsModal
        isOpen={activeModal === 'diagnostics'}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
}
