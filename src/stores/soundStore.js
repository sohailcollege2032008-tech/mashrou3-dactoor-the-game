import { create } from 'zustand';

export const useSoundStore = create((set, get) => ({
  soundEnabled: localStorage.getItem('med_royale_sfx_enabled') !== 'false',
  sfxVolume: parseFloat(localStorage.getItem('med_royale_sfx_volume') ?? '0.7'),
  isSoundModalOpen: false,

  toggleSound: () => {
    const nextState = !get().soundEnabled;
    localStorage.setItem('med_royale_sfx_enabled', String(nextState));
    set({ soundEnabled: nextState });
  },

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    localStorage.setItem('med_royale_sfx_volume', String(clamped));
    set({ sfxVolume: clamped });
  },

  openSoundModal: () => set({ isSoundModalOpen: true }),
  closeSoundModal: () => set({ isSoundModalOpen: false }),
}));
