import { create } from 'zustand';
import type { DecodedMessage, ReceiverPhase } from '../audio/frameAssembler';
import type { FrameProgress } from '../audio/engine';
import { PROFILES, type ProfileId } from '../dsp/profiles';
import type { ScanMode } from '../audio/spectrumScanner';
import { languageOf } from '../i18n/languages';

export interface Received extends DecodedMessage {
  id: string;
  at: number;
  profileId: ProfileId;
}

export type Tab = 'transceiver' | 'send' | 'listen' | 'scanner' | 'log';

/** One line in the on-the-fly translation feed. */
export interface TranslationEntry {
  id: string;
  at: number;
  /** Where the text came from: a decoded frame, or the room's own speech. */
  origin: 'acoustic' | 'ambient';
  original: string;
  translated: string;
  language: { code: string; name: string; confidence: number };
  engine: 'pending' | 'on-device' | 'passthrough' | 'none';
  note?: string;
  /** Set when this row was produced from a received message. */
  messageId?: string;
}

export type ModalType = 'guide' | 'diagnostics' | null;

interface State {
  profileId: ProfileId;
  volume: number;
  drive: number;
  draft: string;
  tab: Tab;

  transmitting: boolean;
  txProgress: number;
  txLabel: string;

  listening: boolean;
  phase: ReceiverPhase;
  snrDb: number;
  noiseDb: number;
  level: number;
  progress: FrameProgress | null;

  soundBearing: number;
  soundConfidence: number;
  compassHeading: number | null;

  messages: Received[];
  notice: string | null;
  error: string | null;
  sampleRate: number;

  soundAlerts: boolean;
  activeModal: ModalType;
  searchQuery: string;

  scanning: boolean;
  scanMode: ScanMode;
  squelchDb: number;
  autoLock: boolean;
  /** Profile the scanner tuned to on its own, so the UI can say why. */
  lockedBy: string | null;

  autoTranslate: boolean;
  targetLang: string;
  ambientLang: string;
  ambientListening: boolean;
  translations: TranslationEntry[];

  setProfile: (id: ProfileId) => void;
  setVolume: (v: number) => void;
  setDrive: (v: number) => void;
  setDraft: (v: string) => void;
  setTab: (t: Tab) => void;
  setTransmitting: (on: boolean, label?: string) => void;
  setTxProgress: (f: number) => void;
  setListening: (on: boolean) => void;
  setMetrics: (m: { phase: ReceiverPhase; snrDb: number; noiseDb: number; level: number }) => void;
  setProgress: (p: FrameProgress | null) => void;
  setSoundDirection: (bearing: number, confidence: number) => void;
  setCompassHeading: (heading: number | null) => void;
  addMessage: (m: DecodedMessage) => void;
  clearMessages: () => void;
  setNotice: (t: string | null) => void;
  setError: (t: string | null) => void;
  setSampleRate: (r: number) => void;
  setSoundAlerts: (on: boolean) => void;
  setActiveModal: (m: ModalType) => void;
  setSearchQuery: (q: string) => void;

  setScanning: (on: boolean) => void;
  setScanMode: (m: ScanMode) => void;
  setSquelchDb: (db: number) => void;
  setAutoLock: (on: boolean) => void;
  setLockedBy: (id: string | null) => void;

  setAutoTranslate: (on: boolean) => void;
  setTargetLang: (code: string) => void;
  setAmbientLang: (code: string) => void;
  setAmbientListening: (on: boolean) => void;
  addTranslation: (t: TranslationEntry) => void;
  patchTranslation: (id: string, patch: Partial<TranslationEntry>) => void;
  clearTranslations: () => void;
}

export const useStore = create<State>((set) => ({
  profileId: 'stealth',
  volume: 0.9,
  drive: 2.2,
  draft: '',
  tab: 'transceiver',

  transmitting: false,
  txProgress: 0,
  txLabel: '',

  listening: false,
  phase: 'searching',
  snrDb: -99,
  noiseDb: -99,
  level: 0,
  progress: null,

  soundBearing: 45,
  soundConfidence: 0,
  compassHeading: null,

  messages: [],
  notice: null,
  error: null,
  sampleRate: 48000,

  soundAlerts: true,
  activeModal: null,
  searchQuery: '',

  scanning: false,
  scanMode: 'wide',
  squelchDb: 9,
  autoLock: true,
  lockedBy: null,

  autoTranslate: true,
  targetLang: 'en',
  ambientLang: defaultAmbientLang(),
  ambientListening: false,
  translations: [],

  setProfile: (profileId) => set({ profileId }),
  setVolume: (volume) => set({ volume }),
  setDrive: (drive) => set({ drive }),
  setDraft: (draft) => set({ draft }),
  setTab: (tab) => set({ tab }),
  setTransmitting: (transmitting, txLabel = '') => set({ transmitting, txLabel, txProgress: 0 }),
  setTxProgress: (txProgress) => set({ txProgress }),
  setListening: (listening) =>
    set(listening ? { listening } : { listening, phase: 'searching', progress: null, snrDb: -99, soundConfidence: 0 }),
  setMetrics: ({ phase, snrDb, noiseDb, level }) => set({ phase, snrDb, noiseDb, level }),
  setProgress: (progress) => set({ progress }),
  setSoundDirection: (soundBearing, soundConfidence) => set({ soundBearing, soundConfidence }),
  setCompassHeading: (compassHeading) => set({ compassHeading }),
  addMessage: (m) =>
    set((s) => {
      // The same frame is sent several times; suppress an identical repeat that
      // lands within a few seconds of the one we already showed.
      const now = Date.now();
      const dupe = s.messages.find((p) => p.text === m.text && now - p.at < 15000);
      if (dupe) return s;
      const entry: Received = {
        ...m,
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        profileId: s.profileId,
      };
      return { messages: [entry, ...s.messages].slice(0, 200) };
    }),
  clearMessages: () => set({ messages: [] }),
  setNotice: (notice) => set({ notice }),
  setError: (error) => set({ error }),
  setSampleRate: (sampleRate) => set({ sampleRate }),
  setSoundAlerts: (soundAlerts) => set({ soundAlerts }),
  setActiveModal: (activeModal) => set({ activeModal }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setScanning: (scanning) => set(scanning ? { scanning } : { scanning, lockedBy: null }),
  setScanMode: (scanMode) => set({ scanMode }),
  setSquelchDb: (squelchDb) => set({ squelchDb }),
  setAutoLock: (autoLock) => set({ autoLock }),
  setLockedBy: (lockedBy) => set({ lockedBy }),

  setAutoTranslate: (autoTranslate) => set({ autoTranslate }),
  setTargetLang: (targetLang) => set({ targetLang }),
  setAmbientLang: (ambientLang) => set({ ambientLang }),
  setAmbientListening: (ambientListening) => set({ ambientListening }),
  addTranslation: (t) => set((s) => ({ translations: [t, ...s.translations].slice(0, 200) })),
  patchTranslation: (id, patch) =>
    set((s) => ({ translations: s.translations.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  clearTranslations: () => set({ translations: [] }),
}));

/** Start the ambient recogniser on the browser's own language when we can. */
function defaultAmbientLang(): string {
  if (typeof navigator === 'undefined') return 'en';
  const code = (navigator.language ?? 'en').split('-')[0];
  return languageOf(code) ? code : 'en';
}

export const profileOf = (id: ProfileId) => PROFILES[id];
