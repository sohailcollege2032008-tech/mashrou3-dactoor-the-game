import { useSoundStore } from '../stores/soundStore';

/**
 * SoundManager — UI & Game Sound Effects (SFX).
 *
 * Two layers:
 *  1. FILE layer: real sound files in /public/sounds (open-source, CC0 —
 *     Kenney.nl UI Audio + Digital Audio packs). MP3 primary (Safari-safe),
 *     OGG fallback.
 *  2. SYNTH layer: Web-Audio synthesized beeps (original implementation),
 *     used automatically if a file is missing or fails to load.
 *
 * Moment map (see docs/SOUND_EFFECTS.md for the full matrix):
 *  playCorrect/playWrong  → answer reveal in games & duels
 *  playMatchAlert         → your match is about to start
 *  playStageStart         → phase transition (FFA→Bracket, round break)
 *  playVictory/playDefeat → duel/tournament match outcome
 *  playChampion           → tournament champion
 *  playEliminated         → knocked out of the tournament
 *  playJoin               → successfully joined a tournament
 *  playTick               → countdown ticking
 *  playOpponentLock       → the other player locked their answer (synth only)
 *  playButtonClick        → UI buttons
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    this._fileExt = null;
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

  /** Prefer MP3 (Safari/Chrome/Firefox all support it); OGG otherwise. */
  _ext() {
    if (this._fileExt) return this._fileExt;
    try {
      const a = new Audio();
      this._fileExt = a.canPlayType('audio/mpeg') ? 'mp3' : 'ogg';
    } catch {
      this._fileExt = 'mp3';
    }
    return this._fileExt;
  }

  /**
   * Play a file from /sounds. Returns true if the file started playing,
   * false if unavailable (so callers can fall back to synthesis).
   */
  _playFile(name, volScale = 1) {
    const { soundEnabled, sfxVolume } = useSoundStore.getState();
    if (!soundEnabled || sfxVolume <= 0) return true; // muted — treat as handled
    try {
      const a = new Audio(`/sounds/${name}.${this._ext()}`);
      a.volume = Math.max(0, Math.min(1, sfxVolume * volScale));
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // file missing/blocked → try OGG, then synth fallback is the caller's job
          if (this._ext() !== 'ogg') {
            try {
              const a2 = new Audio(`/sounds/${name}.ogg`);
              a2.volume = Math.max(0, Math.min(1, sfxVolume * volScale));
              a2.play().catch(() => {});
            } catch { /* silent */ }
          }
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── FILE + SYNTH fallback public API ─────────────────────────────────────────

  playCorrect() {
    if (!this._canPlay()) return;
    if (this._playFile('answer-correct')) return;
    this._synthCorrect();
  }

  playWrong() {
    if (!this._canPlay()) return;
    if (this._playFile('answer-wrong')) return;
    this._synthWrong();
  }

  playMatchAlert() {
    if (!this._canPlay()) return;
    if (this._playFile('match-win', 0.8)) return;
    this._synthMatchAlert();
  }

  playStageStart() {
    if (!this._canPlay()) return;
    if (this._playFile('phase-transition')) return;
    this._synthStageStart();
  }

  playVictory() {
    if (!this._canPlay()) return;
    if (this._playFile('match-win')) return;
    this._synthVictory();
  }

  playDefeat() {
    if (!this._canPlay()) return;
    if (this._playFile('match-lose')) return;
    this._synthDefeat();
  }

  playChampion() {
    if (!this._canPlay()) return;
    if (this._playFile('champion')) return;
    this._synthVictory();
  }

  playEliminated() {
    if (!this._canPlay()) return;
    if (this._playFile('eliminated')) return;
    this._synthDefeat();
  }

  playJoin() {
    if (!this._canPlay()) return;
    if (this._playFile('join-success')) return;
    this._synthMatchAlert();
  }

  playTick() {
    if (!this._canPlay()) return;
    if (this._playFile('countdown-tick', 0.6)) return;
    this._synthTick();
  }

  playButtonClick() {
    if (!this._canPlay()) return;
    if (this._playFile('ui-click', 0.7)) return;
    this._synthButtonClick();
  }

  /**
   * The opponent just locked their answer.
   *
   * Synth-only on purpose: this fires on every question of every duel, so it
   * has to sit under the countdown tick without competing with it, and it must
   * not be mistakable for your own click — hence two quiet blips that FALL
   * (G4 → C4). A file here would be one more asset to load for a sound whose
   * whole job is to be small.
   */
  playOpponentLock() {
    if (!this._canPlay()) return;
    this._synthOpponentLock();
  }

  // ── Original synthesized implementations (fallback) ──────────────────────────

  _synthCorrect() {
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
    playTone(1046.5, now, 0.15);
    playTone(1318.5, now + 0.08, 0.22);
  }

  _synthWrong() {
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

  _synthMatchAlert() {
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
    playTone(880.0, now, 0.12);
    playTone(1318.5, now + 0.09, 0.25);
  }

  _synthStageStart() {
    const vol = this._getVolume();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
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

  _synthVictory() {
    const vol = this._getVolume();
    const now = this.ctx.currentTime;
    const sequence = [
      { freq: 523.25, dur: 0.1, delay: 0 },
      { freq: 659.25, dur: 0.1, delay: 0.09 },
      { freq: 783.99, dur: 0.1, delay: 0.18 },
      { freq: 1046.5, dur: 0.35, delay: 0.27 },
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

  _synthDefeat() {
    const vol = this._getVolume();
    const now = this.ctx.currentTime;
    const sequence = [
      { freq: 392.0, dur: 0.12, delay: 0 },
      { freq: 311.13, dur: 0.25, delay: 0.1 },
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

  _synthTick() {
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

  _synthButtonClick() {
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

  _synthOpponentLock() {
    const vol = this._getVolume();
    const now = this.ctx.currentTime;
    const blip = (freq, start) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.11 * vol, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.08);
    };
    blip(392.0, now);            // G4
    blip(261.63, now + 0.055);   // C4 — falling, so it reads as theirs, not yours
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
