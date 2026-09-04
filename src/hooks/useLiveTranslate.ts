import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, type TranslationEntry } from '../store/useStore';
import { LANGUAGES, languageOf } from '../i18n/languages';
import { probeEngine, resetTranslators, translate, type EngineStatus } from '../i18n/translate';

/* The speech API is still vendor-prefixed in most browsers and is not in the
   DOM lib everywhere, so it is described structurally rather than imported. */
interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecognitionCtor | null;
}

/** How many already-received frames get translated when the feed first opens. */
const BACKLOG = 8;

const newId = () => `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Turns whatever the device hears into readable text in one language.
 *
 * Two sources feed the same queue: frames decoded off the air (any UTF-8 text,
 * in any language, from the other device) and - where the browser offers
 * speech recognition - the room's own speech. Both are identified and then
 * translated by the same on-device pipeline.
 */
export function useLiveTranslate() {
  const messages = useStore((s) => s.messages);
  const translations = useStore((s) => s.translations);
  const addTranslation = useStore((s) => s.addTranslation);
  const patchTranslation = useStore((s) => s.patchTranslation);
  const autoTranslate = useStore((s) => s.autoTranslate);
  const targetLang = useStore((s) => s.targetLang);
  const ambientLang = useStore((s) => s.ambientLang);
  const ambientListening = useStore((s) => s.ambientListening);
  const setAmbientListening = useStore((s) => s.setAmbientListening);

  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [interim, setInterim] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);

  const seen = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const recognition = useRef<Recognition | null>(null);
  const wantAmbient = useRef(false);

  const speechSupported = typeof window !== 'undefined' && recognitionCtor() !== null;

  /* ------------------------------- pipeline ------------------------------ */

  const enqueue = useCallback(
    (entry: Omit<TranslationEntry, 'id' | 'at' | 'translated' | 'engine' | 'language'>, sourceHint?: string) => {
      const id = newId();
      addTranslation({
        ...entry,
        id,
        at: Date.now(),
        translated: '',
        engine: 'pending',
        language: { code: 'und', name: 'Identifying…', confidence: 0 },
      });

      queue.current = queue.current
        .then(async () => {
          const res = await translate(entry.original, {
            source: sourceHint,
            target: targetLang,
            onProgress: (f) => setDownloadPct(f >= 1 ? null : Math.round(f * 100)),
          });
          setDownloadPct(null);
          patchTranslation(id, {
            translated: res.text,
            engine: res.engine,
            note: res.note,
            language: { code: res.detected.code, name: res.detected.name, confidence: res.detected.confidence },
          });
        })
        .catch(() => {
          patchTranslation(id, { engine: 'none', note: 'Translation failed.' });
        });
      return id;
    },
    [addTranslation, patchTranslation, targetLang],
  );

  /* --------------------------- decoded frames ---------------------------- */

  useEffect(() => {
    if (!autoTranslate) return;
    const fresh = messages.filter((m) => !seen.current.has(m.id)).slice(0, BACKLOG).reverse();
    for (const m of fresh) {
      seen.current.add(m.id);
      if (!m.text.trim()) continue;
      enqueue({ origin: 'acoustic', original: m.text, messageId: m.id });
    }
  }, [messages, autoTranslate, enqueue]);

  /* ------------------------------- ambient ------------------------------- */

  const stopAmbient = useCallback(() => {
    wantAmbient.current = false;
    const r = recognition.current;
    recognition.current = null;
    setInterim('');
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
    setAmbientListening(false);
  }, [setAmbientListening]);

  const startAmbient = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setSpeechError('This browser has no speech recognition.');
      return;
    }
    if (recognition.current) return;

    const entry = languageOf(ambientLang) ?? LANGUAGES[0];
    const r = new Ctor();
    r.lang = entry.speech;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const trimmed = text.trim();
          // The recogniser is told which language to expect, so that is the
          // source language - detection would only add a chance to be wrong.
          if (trimmed) enqueue({ origin: 'ambient', original: trimmed }, entry.code);
        } else {
          live += text;
        }
      }
      setInterim(live.trim());
    };

    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setSpeechError(
        e.error === 'not-allowed'
          ? 'Microphone access for speech recognition was denied.'
          : `Speech recognition error: ${e.error}`,
      );
    };

    // Chrome ends the session on every pause; keep it alive while it is wanted.
    r.onend = () => {
      if (!wantAmbient.current) return;
      window.setTimeout(() => {
        if (wantAmbient.current && recognition.current === r) {
          try {
            r.start();
          } catch {
            /* a restart that overlaps the previous session is harmless */
          }
        }
      }, 250);
    };

    wantAmbient.current = true;
    recognition.current = r;
    setSpeechError(null);
    try {
      r.start();
      setAmbientListening(true);
    } catch (err) {
      recognition.current = null;
      wantAmbient.current = false;
      setSpeechError(err instanceof Error ? err.message : 'Could not start speech recognition.');
    }
  }, [ambientLang, enqueue, setAmbientListening]);

  // Switching language mid-session needs a fresh recogniser.
  useEffect(() => {
    if (!ambientListening) return;
    stopAmbient();
    const t = window.setTimeout(startAmbient, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientLang]);

  useEffect(() => () => stopAmbient(), [stopAmbient]);

  /* ------------------------------- status -------------------------------- */

  useEffect(() => {
    let alive = true;
    resetTranslators();
    // With nothing to translate yet there is no pair to ask about, so only
    // report on one when the room language differs from the target.
    const probeSource = ambientLang !== targetLang ? ambientLang : null;
    void probeEngine(probeSource, targetLang).then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [ambientLang, targetLang]);

  const retranslate = useCallback(
    (entry: TranslationEntry) => {
      enqueue({ origin: entry.origin, original: entry.original, messageId: entry.messageId });
    },
    [enqueue],
  );

  return {
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
  };
}
