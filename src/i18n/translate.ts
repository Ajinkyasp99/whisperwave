/**
 * Translation bridge.
 *
 * Chrome ships an on-device Translator and LanguageDetector (the built-in AI
 * APIs). When they are present, translation happens locally - no request
 * leaves the device, which is the only kind of translation that belongs in an
 * app whose entire point is working without a network. When they are absent we
 * still identify the language offline with `detectLanguage` and say plainly
 * that the text could not be translated, rather than quietly shipping the
 * user's decoded messages to a third-party API.
 *
 * The globals are probed defensively: the API moved from `self.ai.translator`
 * to a top-level `Translator` during its origin trial and both shapes are
 * still in the wild.
 */

import { detectLanguage, type LanguageGuess } from './detect';
import { languageName } from './languages';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface EngineStatus {
  translator: Availability;
  detector: Availability;
  /** Whether the browser exposes any on-device translation at all. */
  supported: boolean;
  note: string;
}

export interface TranslationResult {
  text: string;
  detected: LanguageGuess;
  /** 'on-device' when a model translated it, 'none' when only detection ran. */
  engine: 'on-device' | 'passthrough' | 'none';
  note?: string;
}

interface Monitor {
  addEventListener(type: 'downloadprogress', cb: (e: { loaded: number; total?: number }) => void): void;
}

interface TranslatorInstance {
  translate(input: string): Promise<string>;
  destroy?(): void;
}

interface DetectorInstance {
  detect(input: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  destroy?(): void;
}

type Unknown = Record<string, unknown>;

const g = (): Unknown => globalThis as unknown as Unknown;

function translatorApi(): Unknown | null {
  const root = g();
  if (root.Translator) return root.Translator as Unknown;
  const ai = root.ai as Unknown | undefined;
  if (ai?.translator) return ai.translator as Unknown;
  return null;
}

function detectorApi(): Unknown | null {
  const root = g();
  if (root.LanguageDetector) return root.LanguageDetector as Unknown;
  const ai = root.ai as Unknown | undefined;
  if (ai?.languageDetector) return ai.languageDetector as Unknown;
  return null;
}

/** The origin-trial vocabulary and the shipped one differ; normalise both. */
function normalise(value: unknown): Availability {
  switch (String(value)) {
    case 'available':
    case 'readily':
      return 'available';
    case 'downloadable':
    case 'after-download':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

async function availabilityOf(api: Unknown | null, args?: Unknown): Promise<Availability> {
  if (!api) return 'unavailable';
  try {
    const fn = api.availability as ((a?: Unknown) => Promise<unknown>) | undefined;
    if (typeof fn === 'function') return normalise(await fn.call(api, args));

    // Legacy shape: capabilities() then a per-pair query.
    const caps = api.capabilities as (() => Promise<Unknown>) | undefined;
    if (typeof caps === 'function') {
      const c = await caps.call(api);
      if (args && typeof c.languagePairAvailable === 'function') {
        const pair = (c.languagePairAvailable as (s: string, t: string) => unknown)(
          String(args.sourceLanguage),
          String(args.targetLanguage),
        );
        return normalise(pair);
      }
      return normalise(c.available);
    }
  } catch {
    /* a probe should never take the panel down */
  }
  return 'unavailable';
}

/**
 * Report what this browser can do, for one language pair or in general.
 *
 * `source` is null when there is no particular pair to ask about - the text
 * has not arrived yet and its language is unknown - in which case only the
 * presence of the API is reported rather than inventing a pair to probe.
 */
export async function probeEngine(source: string | null, target: string): Promise<EngineStatus> {
  const tApi = translatorApi();
  const dApi = detectorApi();
  const translator = source
    ? await availabilityOf(tApi, { sourceLanguage: source, targetLanguage: target })
    : tApi
    ? 'downloadable'
    : 'unavailable';
  const detector = await availabilityOf(dApi);

  let note: string;
  if (!tApi) {
    note = 'This browser has no on-device translator. Language is still identified offline.';
  } else if (!source) {
    note = 'On-device translation is ready. Each language pair downloads its model the first time it is used.';
  } else if (translator === 'downloadable') {
    note = `The ${languageName(source)} to ${languageName(target)} model has not been downloaded yet.`;
  } else if (translator === 'unavailable') {
    note = `On-device translation is not offered for ${languageName(source)} to ${languageName(target)}.`;
  } else {
    note = 'Translating on-device. Nothing leaves this browser.';
  }

  return { translator, detector, supported: Boolean(tApi), note };
}

/* ------------------------------ detection ------------------------------- */

let detectorPromise: Promise<DetectorInstance | null> | null = null;

async function getDetector(): Promise<DetectorInstance | null> {
  const api = detectorApi();
  if (!api) return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const availability = await availabilityOf(api);
        if (availability === 'unavailable') return null;
        const create = api.create as ((o?: Unknown) => Promise<DetectorInstance>) | undefined;
        if (typeof create !== 'function') return null;
        return await create.call(api, {});
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

/**
 * Ask the browser first, fall back to the offline heuristic. The heuristic
 * also acts as a sanity check: the on-device detector is confident to the
 * point of recklessness on three-word strings.
 */
export async function identify(text: string): Promise<LanguageGuess> {
  const offline = detectLanguage(text);
  try {
    const detector = await getDetector();
    if (detector) {
      const results = await detector.detect(text);
      const top = results?.[0];
      if (top && top.detectedLanguage && top.detectedLanguage !== 'und') {
        const code = top.detectedLanguage.split('-')[0];
        if (top.confidence >= offline.confidence) {
          return { code, name: languageName(code), script: offline.script, confidence: top.confidence, method: 'api' };
        }
      }
    }
  } catch {
    /* fall through to the offline guess */
  }
  return offline;
}

/* ----------------------------- translation ------------------------------ */

const translators = new Map<string, Promise<TranslatorInstance | null>>();

async function getTranslator(
  source: string,
  target: string,
  onProgress?: (fraction: number) => void,
): Promise<TranslatorInstance | null> {
  const api = translatorApi();
  if (!api) return null;
  const key = `${source}>${target}`;
  const cached = translators.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const availability = await availabilityOf(api, { sourceLanguage: source, targetLanguage: target });
      if (availability === 'unavailable') return null;
      const create = api.create as ((o: Unknown) => Promise<TranslatorInstance>) | undefined;
      if (typeof create !== 'function') return null;
      return await create.call(api, {
        sourceLanguage: source,
        targetLanguage: target,
        monitor: (m: Monitor) => {
          m.addEventListener('downloadprogress', (e) => onProgress?.(e.total ? e.loaded / e.total : e.loaded));
        },
      });
    } catch {
      return null;
    }
  })();

  translators.set(key, pending);
  const inst = await pending;
  // A failed pair should be retried later - the model may finish downloading.
  if (!inst) translators.delete(key);
  return inst;
}

export interface TranslateOptions {
  /** Leave undefined to identify the language first. */
  source?: string;
  target: string;
  onProgress?: (fraction: number) => void;
}

export async function translate(text: string, opts: TranslateOptions): Promise<TranslationResult> {
  const trimmed = text.trim();
  const detected = opts.source
    ? { code: opts.source, name: languageName(opts.source), script: '', confidence: 1, method: 'api' as const }
    : await identify(trimmed);

  if (!trimmed) return { text: '', detected, engine: 'none' };

  if (detected.code === opts.target) {
    return { text: trimmed, detected, engine: 'passthrough', note: `Already in ${languageName(opts.target)}.` };
  }
  if (detected.code === 'und') {
    return { text: trimmed, detected, engine: 'none', note: 'Could not identify the language of this text.' };
  }

  const translator = await getTranslator(detected.code, opts.target, opts.onProgress);
  if (!translator) {
    return {
      text: trimmed,
      detected,
      engine: 'none',
      note: `Identified as ${detected.name}, but this browser has no on-device ${detected.name} to ${languageName(opts.target)} model.`,
    };
  }

  try {
    const out = await translator.translate(trimmed);
    return { text: out, detected, engine: 'on-device' };
  } catch (e) {
    return {
      text: trimmed,
      detected,
      engine: 'none',
      note: e instanceof Error ? e.message : 'Translation failed.',
    };
  }
}

/** Drop cached model instances - used when the target language changes. */
export function resetTranslators() {
  for (const p of translators.values()) void p.then((t) => t?.destroy?.()).catch(() => {});
  translators.clear();
}
