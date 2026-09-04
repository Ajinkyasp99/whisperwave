/**
 * Language table for the translator UI.
 *
 * `speech` is the BCP-47 tag handed to the browser speech recogniser, which
 * wants a region; `code` is the ISO-639-1 tag the translation and detection
 * APIs use.
 */

export interface LanguageEntry {
  code: string;
  name: string;
  native: string;
  speech: string;
  rtl?: boolean;
}

export const LANGUAGES: readonly LanguageEntry[] = [
  { code: 'en', name: 'English', native: 'English', speech: 'en-US' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', speech: 'hi-IN' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', speech: 'mr-IN' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', speech: 'bn-IN' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', speech: 'ta-IN' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', speech: 'te-IN' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', speech: 'kn-IN' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', speech: 'ml-IN' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', speech: 'gu-IN' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', speech: 'pa-IN' },
  { code: 'ur', name: 'Urdu', native: 'اردو', speech: 'ur-PK', rtl: true },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', speech: 'ne-NP' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල', speech: 'si-LK' },
  { code: 'ar', name: 'Arabic', native: 'العربية', speech: 'ar-SA', rtl: true },
  { code: 'he', name: 'Hebrew', native: 'עברית', speech: 'he-IL', rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', speech: 'fa-IR', rtl: true },
  { code: 'es', name: 'Spanish', native: 'Español', speech: 'es-ES' },
  { code: 'fr', name: 'French', native: 'Français', speech: 'fr-FR' },
  { code: 'de', name: 'German', native: 'Deutsch', speech: 'de-DE' },
  { code: 'it', name: 'Italian', native: 'Italiano', speech: 'it-IT' },
  { code: 'pt', name: 'Portuguese', native: 'Português', speech: 'pt-BR' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', speech: 'nl-NL' },
  { code: 'pl', name: 'Polish', native: 'Polski', speech: 'pl-PL' },
  { code: 'ro', name: 'Romanian', native: 'Română', speech: 'ro-RO' },
  { code: 'cs', name: 'Czech', native: 'Čeština', speech: 'cs-CZ' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', speech: 'sv-SE' },
  { code: 'da', name: 'Danish', native: 'Dansk', speech: 'da-DK' },
  { code: 'fi', name: 'Finnish', native: 'Suomi', speech: 'fi-FI' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', speech: 'tr-TR' },
  { code: 'ru', name: 'Russian', native: 'Русский', speech: 'ru-RU' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', speech: 'uk-UA' },
  { code: 'bg', name: 'Bulgarian', native: 'Български', speech: 'bg-BG' },
  { code: 'sr', name: 'Serbian', native: 'Српски', speech: 'sr-RS' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', speech: 'el-GR' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', speech: 'id-ID' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', speech: 'vi-VN' },
  { code: 'th', name: 'Thai', native: 'ไทย', speech: 'th-TH' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ', speech: 'km-KH' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ', speech: 'my-MM' },
  { code: 'ka', name: 'Georgian', native: 'ქართული', speech: 'ka-GE' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն', speech: 'hy-AM' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ', speech: 'am-ET' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', speech: 'sw-KE' },
  { code: 'zh', name: 'Chinese', native: '中文', speech: 'zh-CN' },
  { code: 'ja', name: 'Japanese', native: '日本語', speech: 'ja-JP' },
  { code: 'ko', name: 'Korean', native: '한국어', speech: 'ko-KR' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function languageOf(code: string): LanguageEntry | null {
  return BY_CODE.get(code.toLowerCase().split('-')[0]) ?? null;
}

export function languageName(code: string): string {
  return languageOf(code)?.name ?? code.toUpperCase();
}

export function isRtl(code: string): boolean {
  return languageOf(code)?.rtl === true;
}
