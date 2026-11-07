/*
 * Countdown timer, chime and screen wake lock.
 * Uses wall-clock time so it stays accurate if the tab is throttled.
 */
(function (root) {
  'use strict';
  const VST = (root.VST = root.VST || {});

  class Countdown {
    constructor({ onTick, onEnd }) {
      this.onTick = onTick;
      this.onEnd = onEnd;
      this.duration = 0;
      this.remainingMs = 0;
      this.endAt = 0;
      this.running = false;
      this.handle = null;
    }
    set(seconds) {
      this.stopTicking();
      this.running = false;
      this.duration = seconds;
      this.remainingMs = seconds * 1000;
      this.emit();
    }
    start() {
      if (this.running || this.remainingMs <= 0) return;
      this.running = true;
      this.endAt = Date.now() + this.remainingMs;
      this.handle = setInterval(() => this.tick(), 200);
      this.emit();
    }
    pause() {
      if (!this.running) return;
      this.remainingMs = Math.max(0, this.endAt - Date.now());
      this.running = false;
      this.stopTicking();
      this.emit();
    }
    toggle() {
      if (this.running) this.pause();
      else this.start();
    }
    restart() {
      const wasRunning = this.running;
      this.set(this.duration);
      if (wasRunning) this.start();
    }
    /** End the current countdown now. `natural` is true when it ran out on its own. */
    finish(natural = false) {
      this.stopTicking();
      this.running = false;
      this.remainingMs = 0;
      this.emit();
      this.onEnd && this.onEnd(natural);
    }
    tick() {
      this.remainingMs = Math.max(0, this.endAt - Date.now());
      this.emit();
      if (this.remainingMs <= 0) this.finish(true);
    }
    stopTicking() {
      if (this.handle) clearInterval(this.handle);
      this.handle = null;
    }
    emit() {
      this.onTick && this.onTick(this.remainingMs, this.running);
    }
  }

  function format(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /* Soft two-note chime made with Web Audio (no sound files needed). */
  let audio = null;
  function unlockAudio() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {
      audio = null;
    }
  }
  function chime(kind = 'end') {
    if (!audio) return;
    const notes = kind === 'done' ? [660, 880, 1320] : kind === 'soft' ? [880] : [880, 660];
    const t0 = audio.currentTime + 0.02;
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = t0 + i * 0.28;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  }

  /* Keep the screen awake while a timer runs (e.g. an iPad by the easel). */
  let lock = null;
  async function keepAwake(on) {
    try {
      if (on && !lock && root.navigator && navigator.wakeLock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => (lock = null));
      } else if (!on && lock) {
        await lock.release();
        lock = null;
      }
    } catch (e) {
      lock = null;
    }
  }

  VST.timer = { Countdown, format, chime, unlockAudio, keepAwake };
})(typeof window !== 'undefined' ? window : globalThis);
