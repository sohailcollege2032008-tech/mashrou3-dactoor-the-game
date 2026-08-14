import { useSoundStore } from '../stores/soundStore';

class SoundManager {
  constructor() {
    this.ctx = null;
    this.audioCache = {};
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
    return true;
  }

  _getVolume() {
    return useSoundStore.getState().sfxVolume;
  }

  _playMp3(filename) {
    if (!this._canPlay()) return;
    try {
      const vol = this._getVolume();
      const audio = new Audio(`/sounds/${filename}`);
      audio.volume = vol;
      audio.play().catch(err => {
        console.warn(`Could not play /sounds/${filename}:`, err);
      });
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  // --- Sound Effects API ---

  /**
   * Real MP3 Game Show Wrong Buzzer
   */
  playWrong() {
    this._playMp3('wrong.mp3');
  }

  /**
   * Real MP3 Victory Fanfare
   */
  playVictory() {
    this._playMp3('victory.mp3');
  }

  /**
   * Real MP3 Stage Start / Round Start Tada Fanfare
   */
  playStageStart() {
    this._playMp3('tada.mp3');
  }

  /**
   * Real MP3 Defeat / Booing
   */
  playDefeat() {
    this._playMp3('boo.mp3');
  }

  /**
   * Real MP3 Match Call Alert / Gasp Tension
   */
  playMatchAlert() {
    this._playMp3('gasp.mp3');
  }

  /**
   * Real MP3 Audience Applause Celebration
   */
  playApplause() {
    this._playMp3('applause.mp3');
  }

  /**
   * Correct Answer Chime (High-res Harmonic Polyphonic Arcade Chime)
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
      gain.gain.linearRampToValueAtTime(0.5 * masterVol, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    playTone(1046.5, now, 0.18);       // C6
    playTone(1318.5, now + 0.1, 0.4);  // E6
  }

  /**
   * Urgent Timer Countdown Tick
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

    gain.gain.setValueAtTime(0.3 * masterVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  /**
   * Soft Mechanical UI Switch Click
   */
  playButtonClick() {
    if (!this._canPlay()) return;
    const masterVol = this._getVolume();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, now);

    gain.gain.setValueAtTime(0.2 * masterVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.025);
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
