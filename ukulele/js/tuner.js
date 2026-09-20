// Continuous pitch -> note/cents readout, plus a nearest-string helper for
// the baritone's open strings (D3 G3 B3 E4) so the tuner can tell you which
// string you're probably tuning.

const BARITONE_OPEN_STRINGS = [
  { name: 'D3', midi: 50 },
  { name: 'G3', midi: 55 },
  { name: 'B3', midi: 59 },
  { name: 'E4', midi: 64 },
];

function nearestOpenString(midi) {
  let best = BARITONE_OPEN_STRINGS[0];
  let bestDist = Infinity;
  for (const s of BARITONE_OPEN_STRINGS) {
    const d = Math.abs(s.midi - midi);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

class Tuner {
  constructor(audioCtx, analyser) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
    this.running = false;
    this.onUpdate = null;
    this._raf = null;
  }

  start() {
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
    const freq = autoCorrelate(this.buf, this.ctx.sampleRate);
    if (freq !== -1) {
      const info = noteFromFrequency(freq);
      const string = nearestOpenString(info.midi);
      if (this.onUpdate) this.onUpdate({ freq, ...info, nearestString: string });
    } else if (this.onUpdate) {
      this.onUpdate(null);
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }
}
