import { LANGUAGES, isRtl, languageOf } from '../i18n/languages';
import { useLiveTranslate } from '../hooks/useLiveTranslate';
import { useStore, type TranslationEntry } from '../store/useStore';
import { Badge, Button, Panel, PanelTitle, Toggle } from './ui';
import {
  Languages,
  Mic,
  MicOff,
  Radio,
  Sparkles,
  ShieldCheck,
  CloudOff,
  RefreshCw,
  Copy,
  Trash2,
  Loader2,
} from 'lucide-react';

/**
 * Live translation feed.
 *
 * Anything the device receives - a decoded acoustic frame in any language, or
 * the speech in the room - is identified and rendered in one chosen language,
 * as it arrives.
 */
export function TranslatePanel() {
  const {
    translations,
    status,
    downloadPct,
    interim,
    speechError,
    speechSupported,
    ambientListening,
    startAmbient,
    stopAmbient,
    retranslate,
  } = useLiveTranslate();

  const targetLang = useStore((s) => s.targetLang);
  const setTargetLang = useStore((s) => s.setTargetLang);
  const ambientLang = useStore((s) => s.ambientLang);
  const setAmbientLang = useStore((s) => s.setAmbientLang);
  const autoTranslate = useStore((s) => s.autoTranslate);
  const setAutoTranslate = useStore((s) => s.setAutoTranslate);
  const clearTranslations = useStore((s) => s.clearTranslations);

  const onDevice = status?.translator === 'available';

  return (
    <Panel highlight={ambientListening} cornerMarks>
      <PanelTitle
        icon={<Languages className="h-4 w-4" />}
        hint={onDevice ? 'ON-DEVICE' : status?.supported ? 'MODEL PENDING' : 'DETECT ONLY'}
      >
        On-the-fly Translation
      </PanelTitle>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5">
          <span className="mb-1 block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/45">
            Show everything in
          </span>
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            aria-label="Target language"
            className="w-full rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-white/30"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} className="bg-slate-900">
                {l.name} · {l.native}
              </option>
            ))}
          </select>
        </label>

        <label className="block rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5">
          <span className="mb-1 block text-[0.62rem] font-bold uppercase tracking-[0.14em] text-white/45">
            Room is speaking
          </span>
          <select
            value={ambientLang}
            onChange={(e) => setAmbientLang(e.target.value)}
            aria-label="Ambient speech language"
            className="w-full rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-white/30"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} className="bg-slate-900">
                {l.name} · {l.native}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        <Toggle
          label="Translate decoded frames"
          hint="Any language, identified and rendered as each frame lands"
          icon={<Radio className="h-3.5 w-3.5" />}
          checked={autoTranslate}
          onChange={setAutoTranslate}
        />
        <Button
          variant={ambientListening ? 'danger' : 'secondary'}
          onClick={() => (ambientListening ? stopAmbient() : startAmbient())}
          disabled={!speechSupported}
          icon={ambientListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          className="w-full"
        >
          {!speechSupported
            ? 'Speech capture unsupported'
            : ambientListening
            ? 'Stop listening to the room'
            : 'Translate the room live'}
        </Button>
      </div>

      {/* Where the translation is actually happening - worth being explicit
          about in an app that otherwise touches no network at all. */}
      <div
        className={`mt-3 flex items-start gap-2 rounded-xl border p-2.5 text-[0.68rem] leading-relaxed ${
          onDevice
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100/85'
            : 'border-white/[0.08] bg-white/[0.025] text-white/55'
        }`}
      >
        {onDevice ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
        )}
        <div className="min-w-0">
          <p>{status?.note ?? 'Checking what this browser can translate…'}</p>
          {downloadPct !== null && (
            <p className="num mt-1 text-white/60">Downloading language model… {downloadPct}%</p>
          )}
          {ambientListening && (
            <p className="mt-1 text-amber-200/80">
              Speech recognition is the browser's own service and may process audio in the cloud; decoded frames never
              leave the device.
            </p>
          )}
        </div>
      </div>

      {speechError && (
        <p className="mt-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-2.5 text-[0.68rem] text-rose-100">
          {speechError}
        </p>
      )}

      {ambientListening && (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/40 p-2.5">
          <span className="flex h-2 w-2 shrink-0 rounded-full accent-bg animate-pulse" />
          <p className="min-w-0 flex-1 truncate text-xs italic text-white/60">
            {interim || 'Listening for speech…'}
          </p>
        </div>
      )}

      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-white/55">Live feed</h3>
        {translations.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clearTranslations} icon={<Trash2 className="h-3.5 w-3.5" />}>
            Clear
          </Button>
        )}
      </div>

      {translations.length === 0 ? (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-relaxed text-white/50">
          Nothing translated yet. Decode a frame, or start listening to the room, and each line appears here in{' '}
          <strong className="text-white/75">{languageOf(targetLang)?.name ?? targetLang}</strong> with the language it
          came from named alongside it.
        </p>
      ) : (
        <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-0.5">
          {translations.map((t) => (
            <TranslationRow key={t.id} entry={t} onRetry={retranslate} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TranslationRow({
  entry,
  onRetry,
}: {
  entry: TranslationEntry;
  onRetry: (e: TranslationEntry) => void;
}) {
  const pending = entry.engine === 'pending';
  const untranslated = entry.engine === 'none';
  const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <li className="rounded-xl border border-white/[0.09] bg-white/[0.03] p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={entry.origin === 'acoustic' ? 'accent' : 'neutral'} icon={entry.origin === 'acoustic' ? <Radio className="h-3 w-3" /> : <Mic className="h-3 w-3" />}>
          {entry.origin === 'acoustic' ? 'Decoded frame' : 'Room speech'}
        </Badge>
        <Badge tone={pending ? 'neutral' : untranslated ? 'warn' : 'success'}>
          {pending ? 'Identifying…' : entry.language.name}
        </Badge>
        {!pending && entry.language.confidence > 0 && (
          <span className="num text-[0.58rem] text-white/35">
            {Math.round(entry.language.confidence * 100)}% sure
          </span>
        )}
        {entry.engine === 'on-device' && (
          <span className="flex items-center gap-1 text-[0.58rem] font-bold text-emerald-300/80">
            <Sparkles className="h-3 w-3" /> on-device
          </span>
        )}
        <span className="num ml-auto text-[0.58rem] text-white/35">{time}</span>
      </div>

      <p
        dir={isRtl(entry.language.code) ? 'rtl' : 'ltr'}
        className="text-[0.72rem] leading-relaxed text-white/45"
      >
        {entry.original}
      </p>

      <div className="mt-1.5 flex items-start gap-2 border-t border-white/[0.07] pt-1.5">
        {pending ? (
          <span className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> translating…
          </span>
        ) : (
          <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-white">
            {entry.translated || entry.original}
          </p>
        )}
        {!pending && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label="Copy translation"
              onClick={() => void navigator.clipboard?.writeText(entry.translated || entry.original)}
              className="no-tap rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Translate again"
              onClick={() => onRetry(entry)}
              className="no-tap rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {entry.note && <p className="mt-1.5 text-[0.62rem] leading-relaxed text-amber-200/70">{entry.note}</p>}
    </li>
  );
}
