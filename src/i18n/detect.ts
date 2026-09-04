/**
 * Offline language identification.
 *
 * The browser's on-device LanguageDetector is used when it exists, but it does
 * not exist in most browsers, and a decoded frame is far too short for a real
 * n-gram model anyway. This is the fallback that always works: identify the
 * writing system first (which pins most of the world's languages outright),
 * then disambiguate inside a shared script with marker words and characters,
 * and only fall back to stop-word scoring for Latin script.
 *
 * Pure - no DOM, no async - so the node tests can hammer it.
 */

import { languageName } from './languages';

export interface LanguageGuess {
  /** ISO-639-1 code, or 'und' when there is nothing to go on. */
  code: string;
  name: string;
  /** Writing system the text is in, for display. */
  script: string;
  /** 0..1. Short strings are capped low no matter how clean the match is. */
  confidence: number;
  method: 'script' | 'markers' | 'stopwords' | 'api' | 'unknown';
}

/** Unicode blocks that identify a script from a single character. */
const SCRIPTS: Array<{ name: string; re: RegExp; lang?: string }> = [
  { name: 'Devanagari', re: /[ऀ-ॿ]/ },
  { name: 'Bengali', re: /[ঀ-৿]/, lang: 'bn' },
  { name: 'Gurmukhi', re: /[਀-੿]/, lang: 'pa' },
  { name: 'Gujarati', re: /[઀-૿]/, lang: 'gu' },
  { name: 'Tamil', re: /[஀-௿]/, lang: 'ta' },
  { name: 'Telugu', re: /[ఀ-౿]/, lang: 'te' },
  { name: 'Kannada', re: /[ಀ-೿]/, lang: 'kn' },
  { name: 'Malayalam', re: /[ഀ-ൿ]/, lang: 'ml' },
  { name: 'Sinhala', re: /[඀-෿]/, lang: 'si' },
  { name: 'Thai', re: /[฀-๿]/, lang: 'th' },
  { name: 'Lao', re: /[຀-໿]/, lang: 'lo' },
  { name: 'Myanmar', re: /[က-႟]/, lang: 'my' },
  { name: 'Khmer', re: /[ក-៿]/, lang: 'km' },
  { name: 'Georgian', re: /[Ⴀ-ჿ]/, lang: 'ka' },
  { name: 'Armenian', re: /[԰-֏]/, lang: 'hy' },
  { name: 'Ethiopic', re: /[ሀ-፿]/, lang: 'am' },
  { name: 'Hebrew', re: /[֐-׿]/, lang: 'he' },
  { name: 'Arabic', re: /[؀-ۿݐ-ݿﭐ-﷿]/ },
  { name: 'Greek', re: /[Ͱ-Ͽ]/, lang: 'el' },
  { name: 'Cyrillic', re: /[Ѐ-ӿ]/ },
  { name: 'Hangul', re: /[가-힯ᄀ-ᇿ]/, lang: 'ko' },
  { name: 'Kana', re: /[぀-ヿ]/, lang: 'ja' },
  { name: 'Han', re: /[一-鿿]/, lang: 'zh' },
  { name: 'Latin', re: /[A-Za-zÀ-ɏ]/ },
];

/**
 * Words and letters that separate languages sharing one script.
 *
 * Matching is done against tokenised words rather than `\b` boundaries: the
 * regex word boundary is defined on ASCII, so `\bआहे\b` never matches
 * anything and every Devanagari string would fall through to the default.
 */
interface MarkerSet {
  code: string;
  words: string[];
  /** Characters used by one language of the group and not the others. */
  chars?: RegExp;
}

const MARKERS: Record<string, MarkerSet[]> = {
  Devanagari: [
    { code: 'mr', words: ['आहे', 'आहेत', 'मध्ये', 'आणि', 'नाही', 'तुम्ही', 'मला', 'माझा', 'करत', 'होता'] },
    { code: 'ne', words: ['छ', 'छन्', 'गर्न', 'गरेको', 'भएको', 'तपाईं', 'हुन्छ', 'भन्ने'] },
    { code: 'hi', words: ['है', 'हैं', 'और', 'नहीं', 'मैं', 'किया', 'करना', 'आप', 'यह', 'से', 'हूँ', 'था'] },
  ],
  Arabic: [
    { code: 'ur', words: ['ہے', 'ہیں', 'نہیں', 'کیا', 'اور', 'میں'], chars: /[ہٹڈڑںے]/ },
    { code: 'fa', words: ['است', 'می', 'های', 'که', 'را', 'این'], chars: /[پچژگ]/ },
    { code: 'ar', words: ['في', 'من', 'على', 'هذا', 'هذه', 'الذي', 'إلى', 'التي', 'أن'] },
  ],
  Cyrillic: [
    { code: 'uk', words: ['та', 'що', 'це', 'не', 'для'], chars: /[іїєґ]/ },
    { code: 'sr', words: ['је', 'су', 'није', 'али'], chars: /[ђјљњћџ]/ },
    { code: 'bg', words: ['ще', 'съм', 'към', 'има'], chars: /ъ/ },
    { code: 'ru', words: ['это', 'что', 'не', 'на', 'как', 'был'], chars: /[ыэё]/ },
  ],
};

/** Frequent function words, which are the cheapest strong signal in Latin script. */
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'to', 'of', 'in', 'you', 'that', 'it', 'for', 'we', 'are', 'this', 'with', 'not'],
  es: ['el', 'la', 'de', 'que', 'y', 'los', 'en', 'una', 'por', 'con', 'para', 'está', 'como', 'pero'],
  fr: ['le', 'la', 'les', 'de', 'et', 'est', 'une', 'des', 'pour', 'que', 'dans', 'nous', 'vous', 'pas'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'auf', 'für', 'wir', 'sie', 'zu'],
  it: ['il', 'la', 'di', 'che', 'non', 'una', 'per', 'sono', 'con', 'del', 'gli', 'anche', 'come'],
  pt: ['de', 'que', 'não', 'uma', 'com', 'para', 'você', 'está', 'como', 'mais', 'são', 'isso', 'ele'],
  nl: ['de', 'het', 'een', 'niet', 'van', 'en', 'is', 'dat', 'op', 'te', 'zijn', 'voor', 'met', 'ik'],
  sv: ['och', 'att', 'det', 'är', 'som', 'en', 'på', 'för', 'med', 'inte', 'har', 'jag', 'till'],
  da: ['og', 'det', 'er', 'til', 'en', 'af', 'for', 'ikke', 'med', 'har', 'jeg', 'som', 'på'],
  fi: ['ja', 'on', 'ei', 'se', 'että', 'ovat', 'olen', 'mutta', 'kun', 'niin', 'tämä'],
  pl: ['nie', 'się', 'jest', 'na', 'to', 'że', 'do', 'jak', 'ale', 'czy', 'tak', 'jestem'],
  ro: ['este', 'și', 'nu', 'de', 'la', 'cu', 'pentru', 'sunt', 'care', 'din', 'mai'],
  cs: ['je', 'na', 'se', 'že', 'není', 'jsem', 'ale', 'jak', 'pro', 'jsou', 'to'],
  tr: ['bir', 'bu', 've', 'için', 'ile', 'daha', 'çok', 'ben', 'değil', 'var', 'ne'],
  id: ['yang', 'dan', 'di', 'ini', 'itu', 'untuk', 'tidak', 'dengan', 'dari', 'saya', 'adalah'],
  vi: ['không', 'của', 'và', 'là', 'có', 'được', 'người', 'những', 'cho', 'tôi', 'một'],
  sw: ['na', 'ya', 'kwa', 'ni', 'katika', 'wa', 'hii', 'yake', 'sana', 'kuwa'],
};

function dominantScript(text: string): { name: string; lang?: string; letters: number } {
  let best = { name: 'Unknown', lang: undefined as string | undefined, count: 0 };
  let letters = 0;
  for (const s of SCRIPTS) {
    const re = new RegExp(s.re.source, 'g');
    const count = (text.match(re) ?? []).length;
    letters += count;
    // Kana beats Han for Japanese even when kanji outnumber the kana.
    const weight = s.name === 'Kana' ? count * 3 : count;
    if (weight > best.count) best = { name: s.name, lang: s.lang, count: weight };
  }
  return { name: best.name, lang: best.lang, letters };
}

/** Split into words in a way that works for every script, not just ASCII. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
}

function scoreMarkers(text: string, table: MarkerSet[]) {
  const words = new Set(tokenize(text));
  // Ties fall to the last entry, which is the most widely spoken language of
  // each script group.
  let bestCode = table[table.length - 1].code;
  let bestScore = 0;
  let runnerUp = 0;
  for (const entry of table) {
    let score = 0;
    for (const w of entry.words) if (words.has(w)) score++;
    if (entry.chars && entry.chars.test(text)) score += 1.5;
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestCode = entry.code;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  return { code: bestCode, score: bestScore, margin: bestScore - runnerUp };
}

function scoreStopwords(text: string) {
  const words = tokenize(text);
  if (words.length === 0) return { code: 'und', score: 0, margin: 0, words: 0 };

  const scores: Array<{ code: string; score: number }> = [];
  for (const [code, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    let hits = 0;
    for (const w of words) if (set.has(w)) hits++;
    // Diacritics that only some languages use are worth a partial hit each.
    if (code === 'vi' && /[ăâđêôơư]/.test(text)) hits += 1.5;
    if (code === 'pl' && /[ąćęłńśźż]/.test(text)) hits += 1.5;
    if (code === 'tr' && /[ğışçö]/.test(text)) hits += 1;
    if (code === 'de' && /[äöüß]/.test(text)) hits += 1;
    if (code === 'pt' && /[ãõç]/.test(text)) hits += 1;
    if (code === 'es' && /[ñ¿¡]/.test(text)) hits += 1;
    if (code === 'fr' && /[àèùçœ]/.test(text)) hits += 1;
    if (code === 'ro' && /[șțăî]/.test(text)) hits += 1;
    if (code === 'cs' && /[řůěščž]/.test(text)) hits += 1;
    scores.push({ code, score: hits / Math.sqrt(words.length) });
  }
  scores.sort((a, b) => b.score - a.score);
  return {
    code: scores[0].score > 0 ? scores[0].code : 'und',
    score: scores[0].score,
    margin: scores[0].score - (scores[1]?.score ?? 0),
    words: words.length,
  };
}

const guess = (code: string, script: string, confidence: number, method: LanguageGuess['method']): LanguageGuess => ({
  code,
  name: code === 'und' ? 'Unknown' : languageName(code),
  script,
  confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  method,
});

export function detectLanguage(text: string): LanguageGuess {
  const trimmed = text.trim();
  if (!trimmed) return guess('und', 'Unknown', 0, 'unknown');

  const script = dominantScript(trimmed);
  if (script.letters === 0) return guess('und', 'Unknown', 0, 'unknown');

  // Length ceiling: three words of Spanish is a hint, not a determination.
  const lengthFactor = Math.min(1, 0.45 + trimmed.length / 60);

  const table = MARKERS[script.name];
  if (table) {
    const m = scoreMarkers(trimmed, table);
    const conf = m.score === 0 ? 0.4 : Math.min(0.95, 0.55 + m.score * 0.12 + m.margin * 0.06);
    return guess(m.code, script.name, conf * lengthFactor, m.score > 0 ? 'markers' : 'script');
  }

  if (script.name === 'Latin') {
    const s = scoreStopwords(trimmed);
    if (s.code === 'und') return guess('en', 'Latin', 0.25, 'script');
    const conf = Math.min(0.94, 0.4 + s.score * 0.5 + s.margin * 0.6);
    return guess(s.code, 'Latin', conf * lengthFactor, 'stopwords');
  }

  if (script.lang) return guess(script.lang, script.name, 0.92 * lengthFactor, 'script');
  return guess('und', script.name, 0.2, 'unknown');
}
