// Web Audio lookahead-scheduling metronome (the standard technique for
// sample-accurate timing in the browser -- setInterval/setTimeout alone
// drift too much for rhythm feedback to be meaningful). Schedules clicks
// slightly ahead of playback time and keeps a log of exact beat times so
// other modules (auto-scroll, rhythm coach) can compare against them.

class Metronome {
  constructor(audioCtx) {
    this.ctx = audioCtx;
    this.bpm = 90;
    this.beatsPerBar = 4;
    this.lookaheadMs = 25;
    this.scheduleAheadSec = 0.12;
    this.nextNoteTime = 0;
    this.currentBeat = 0;
    this.timerId = null;
    this.running = false;
    this.beatLog = [];
    this.onBeat = null; // (beatIndex, audioTime) -- fired ~on time via setTimeout
    this.muted = false;
  }

  start(bpm, beatsPerBar = 4) {
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this.currentBeat = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.beatLog = [];
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = null;
  }

  setTempo(bpm) {
    this.bpm = bpm;
  }

  _tick() {
    if (!this.running) return;
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadSec) {
      this._scheduleClick(this.currentBeat, this.nextNoteTime);
      this.beatLog.push({ beat: this.currentBeat, time: this.nextNoteTime });
      if (this.beatLog.length > 500) this.beatLog.shift();

      const secondsPerBeat = 60.0 / this.bpm;
      this.nextNoteTime += secondsPerBeat;
      this.currentBeat = (this.currentBeat + 1) % this.beatsPerBar;
    }
    this.timerId = setTimeout(() => this._tick(), this.lookaheadMs);
  }

  _scheduleClick(beatIndex, time) {
    if (!this.muted) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = beatIndex === 0 ? 1000 : 750;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.35, time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.07);
    }
    if (this.onBeat) {
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      setTimeout(() => {
        if (this.running) this.onBeat(beatIndex, time);
      }, delayMs);
    }
  }

  recentBeats(windowSec = 4) {
    const now = this.ctx.currentTime;
    return this.beatLog.filter((b) => b.time > now - windowSec && b.time < now + windowSec);
  }
}
