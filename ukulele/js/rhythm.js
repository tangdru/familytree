// Rhythm Coach: detects note onsets from the mic (a simple energy-flux
// detector -- flag a frame as an onset when its RMS energy jumps well
// above the recent rolling average, with a refractory period so one
// strum doesn't fire twice) and scores each onset against the nearest
// metronome beat time to give live timing feedback.

class RhythmCoach {
  constructor(audioCtx, analyser, metronome) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.metronome = metronome;
    this.buf = new Float32Array(analyser.fftSize);
    this.energyHistory = [];
    this.lastOnsetTime = 0;
    this.refractorySec = 0.15;
    this.hits = [];
    this.running = false;
    this.onHit = null;
    this._raf = null;
  }

  start() {
    this.hits = [];
    this.energyHistory = [];
    this.lastOnsetTime = 0;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _loop() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sumSq = 0;
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sumSq / this.buf.length);
    const now = this.ctx.currentTime;

    this.energyHistory.push({ t: now, e: rms });
    while (this.energyHistory.length && this.energyHistory[0].t < now - 1) this.energyHistory.shift();
    const avg = this.energyHistory.reduce((s, x) => s + x.e, 0) / this.energyHistory.length;

    if (rms > avg * 1.8 && rms > 0.02 && now - this.lastOnsetTime > this.refractorySec) {
      this.lastOnsetTime = now;
      this._registerOnset(now);
    }

    this._raf = requestAnimationFrame(() => this._loop());
  }

  _registerOnset(time) {
    const beats = this.metronome.beatLog;
    if (!beats.length) return;
    let nearest = null;
    let best = Infinity;
    for (const b of beats) {
      const d = Math.abs(b.time - time);
      if (d < best) {
        best = d;
        nearest = b;
      }
    }
    if (!nearest) return;

    const deltaMs = (time - nearest.time) * 1000;
    const abs = Math.abs(deltaMs);
    let rating;
    if (abs <= 40) rating = 'perfect';
    else if (abs <= 100) rating = 'good';
    else if (abs <= 200) rating = 'off';
    else rating = 'miss';

    const hit = { time, beat: nearest.beat, deltaMs, rating };
    this.hits.push(hit);
    if (this.hits.length > 300) this.hits.shift();
    if (this.onHit) this.onHit(hit);
  }

  stats(windowSec = 20) {
    const now = this.ctx.currentTime;
    const recent = this.hits.filter((h) => h.time > now - windowSec);
    if (!recent.length) return { count: 0, avgAbsMs: 0, onTimePct: 0 };
    const avgAbsMs = recent.reduce((s, h) => s + Math.abs(h.deltaMs), 0) / recent.length;
    const onTimePct = (recent.filter((h) => h.rating === 'perfect' || h.rating === 'good').length / recent.length) * 100;
    return { count: recent.length, avgAbsMs, onTimePct };
  }
}
