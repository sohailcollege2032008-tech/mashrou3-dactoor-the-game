import { useSoundStore } from '../stores/soundStore';

class SoundManager {
  constructor() {
    this.ctx = null;
    this._initialized = false;
  }

  init() {
    if (this._initialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this._initialized = true;
      }
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  _canPlay() {
    const { soundEnabled, sfxVolume } = useSoundStore.getState();
    if (!soundEnabled || sfxVolume <= 0) return false;
    
    this.init();
    if (!this.ctx) return false;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  _getVolume() {
    return useSoundStore.getState().sfxVolume;
  }

  // --- Sound Synthesizers ---

  /**
   * Correct Answer Chime (Double Arcade Ding)
   */
  playCorrect() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const playTone = (freq, startTime, duration) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.4 * masterVol, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    playTone(1046.5, now, 0.15);       // C6
    playTone(1318.5, now + 0.1, 0.35); // E6
  }

  /**
   * Wrong Answer Buzz (Low Sawtooth Drop)
   */
  playWrong() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.3);

    gain.gain.setValueAtTime(0.35 * masterVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  /**
   * Tournament Match Alert Chime (3-note Ascending Notification)
   */
  playMatchAlert() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const notes = [
      { freq: 880.0, time: 0 },    // A5
      { freq: 1174.6, time: 0.12 }, // D6
      { freq: 1318.5, time: 0.24 }, // E6
      { freq: 1760.0, time: 0.36 }  // A6
    ];

    notes.forEach(({ freq, time }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);

      gain.gain.setValueAtTime(0, now + time);
      gain.gain.linearRampToValueAtTime(0.3 * masterVol, now + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + 0.4);
    });
  }

  /**
   * New Stage / Round Start Sweep (Epic Chord Arpeggio)
   */
  playStageStart() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const chord = [261.6, 329.6, 392.0, 523.25]; // C4, E4, G4, C5
    chord.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.35 * masterVol, now + idx * 0.06 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.6);
    });
  }

  /**
   * Victory Fanfare (Celebratory Champion Melody)
   */
  playVictory() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const sequence = [
      { freq: 523.25, dur: 0.15, delay: 0 },    // C5
      { freq: 659.25, dur: 0.15, delay: 0.15 }, // E5
      { freq: 783.99, dur: 0.15, delay: 0.30 }, // G5
      { freq: 1046.5, dur: 0.45, delay: 0.45 }  // High C6
    ];

    sequence.forEach(({ freq, dur, delay }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.4 * masterVol, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });
  }

  /**
   * Defeat / Game Over Sound (Descending Cadence)
   */
  playDefeat() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const sequence = [
      { freq: 392.0, dur: 0.2, delay: 0 },    // G4
      { freq: 311.13, dur: 0.2, delay: 0.2 }, // Eb4
      { freq: 261.63, dur: 0.5, delay: 0.4 }  // C4
    ];

    sequence.forEach(({ freq, dur, delay }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);

      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.3 * masterVol, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });
  }

  /**
   * Countdown Timer Urgent Tick
   */
  playTick() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);

    gain.gain.setValueAtTime(0.2 * masterVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  /**
   * Soft UI Button Click
   */
  playButtonClick() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, now);

    gain.gain.setValueAtTime(0.15 * masterVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.025);
  }
}

export const soundManager = new SoundManager();

// Initialize AudioContext on first user interaction anywhere on the document
if (typeof window !== 'undefined') {
  const initAudio = () => {
    soundManager.init();
    window.removeEventListener('pointerdown', initAudio);
    window.removeEventListener('keydown', initAudio);
  };
  window.addEventListener('pointerdown', initAudio);
  window.addEventListener('keydown', initAudio);
}
