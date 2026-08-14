import { useSoundStore } from '../stores/soundStore';

/**
 * SoundManager — Ultra-clean, subtle, modern UI & Game Sound Effects (SFX).
 * All sounds are designed to be short (<0.4s), non-intrusive, crisp, and satisfying.
 */
class SoundManager {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {
        console.warn('Web Audio API not supported:', e);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _canPlay() {
    const { soundEnabled, sfxVolume } = useSoundStore.getState();
    if (!soundEnabled || sfxVolume <= 0) return false;
    this.init();
    return !!this.ctx;
  }

  _getVolume() {
    return useSoundStore.getState().sfxVolume;
  }

  // --- Subtle & Crisp Audio Effects ---

  /**
   * Correct Answer — Short, satisfying arcade double chime (0.2s)
   */
  playCorrect() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const playTone = (freq, start, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3 * vol, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(1046.5, now, 0.15);       // High C6
    playTone(1318.5, now + 0.08, 0.22); // High E6
  }

  /**
   * Wrong Answer — Soft, low-pitched error thud (0.2s, non-jarring)
   */
  playWrong() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.2);

    gain.gain.setValueAtTime(0.25 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.22);
  }

  /**
   * Match Alert — Clean dual-tone notification ring (0.25s)
   */
  playMatchAlert() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const playTone = (freq, start, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25 * vol, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(880.0, now, 0.12);        // A5
    playTone(1318.5, now + 0.09, 0.25); // E6
  }

  /**
   * Stage / Round Start — Short energetic tri-tone power-up (0.3s)
   */
  playStageStart() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);

      gain.gain.setValueAtTime(0, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(0.25 * vol, now + idx * 0.07 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.25);
    });
  }

  /**
   * Victory — Short 4-note victory chime (0.4s)
   */
  playVictory() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const sequence = [
      { freq: 523.25, dur: 0.1, delay: 0 },    // C5
      { freq: 659.25, dur: 0.1, delay: 0.09 }, // E5
      { freq: 783.99, dur: 0.1, delay: 0.18 }, // G5
      { freq: 1046.5, dur: 0.35, delay: 0.27 } // High C6
    ];

    sequence.forEach(({ freq, dur, delay }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.3 * vol, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });
  }

  /**
   * Defeat — Short, subtle minor 2-note drop (0.25s)
   */
  playDefeat() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const sequence = [
      { freq: 392.0, dur: 0.12, delay: 0 },   // G4
      { freq: 311.13, dur: 0.25, delay: 0.1 } // Eb4
    ];

    sequence.forEach(({ freq, dur, delay }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.25 * vol, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });
  }

  /**
   * Countdown Tick — Ultra-short 15ms tap
   */
  playTick() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.02);

    gain.gain.setValueAtTime(0.2 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  }

  /**
   * UI Click — Subtle 15ms button tap
   */
  playButtonClick() {
    if (!this._canPlay()) return;
    const vol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);

    gain.gain.setValueAtTime(0.15 * vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.02);
  }
}

export const soundManager = new SoundManager();

if (typeof window !== 'undefined') {
  const initAudio = () => {
    soundManager.init();
    window.removeEventListener('pointerdown', initAudio);
    window.removeEventListener('keydown', initAudio);
  };
  window.addEventListener('pointerdown', initAudio);
  window.addEventListener('keydown', initAudio);
}
