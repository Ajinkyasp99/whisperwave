import { create } from 'zustand';
import type { DecodedMessage, ReceiverPhase } from '../audio/frameAssembler';
import type { FrameProgress } from '../audio/engine';
import { PROFILES, type ProfileId } from '../dsp/profiles';

export interface Received extends DecodedMessage {
  id: string;
  at: number;
  profileId: ProfileId;
}

export type Tab = 'transceiver' | 'send' | 'listen' | 'log';

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
}));

export const profileOf = (id: ProfileId) => PROFILES[id];
