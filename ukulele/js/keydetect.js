// Key detection by listening: build a pitch-class histogram (chroma) from
// a few seconds of mic input, then correlate it against the Krumhansl-
// Schmuckler major/minor key profiles (empirically-derived "how much does
// each pitch class belong in this key" weights) to find the best-fitting
// key. This is a well-established lightweight algorithm for exactly this,
// no external service required.

const KEY_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom ? num / denom : 0;
}

class KeyDetector {
  constructor(audioCtx, analyser) {
    this.ctx = audioCtx;
    this.analyser = analyser;
    this.buf = new Float32Array(analyser.fftSize);
    this.chroma = new Array(12).fill(0);
    this.samples = 0;
    this.running = false;
    this._raf = null;
    this.onProgress = null; // (fractionDone)
  }

  start(durationSec = 6) {
    this.chroma = new Array(12).fill(0);
    this.samples = 0;
    this.running = true;
    this.startTime = this.ctx.currentTime;
    this.endTime = this.startTime + durationSec;
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._loop();
    });
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _loop() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const freq = autoCorrelate(this.buf, this.ctx.sampleRate);
    if (freq > 0) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      const pc = ((midi % 12) + 12) % 12;
      this.chroma[pc]++;
      this.samples++;
    }

    if (this.onProgress) {
      const frac = Math.min(1, (this.ctx.currentTime - this.startTime) / (this.endTime - this.startTime));
      this.onProgress(frac);
    }

    if (this.ctx.currentTime >= this.endTime) {
      this.running = false;
      const result = this._estimate();
      if (this._resolve) this._resolve(result);
      return;
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _estimate() {
    if (!this.samples) return null;
    let best = null;
    for (let root = 0; root < 12; root++) {
      for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]]) {
        const rotated = profile.map((_, i) => profile[((i - root) % 12 + 12) % 12]);
        const corr = correlate(this.chroma, rotated);
        if (!best || corr > best.corr) best = { root, mode, corr };
      }
    }
    return {
      key: KEY_NOTE_NAMES[best.root] + (best.mode === 'minor' ? 'm' : ''),
      root: best.root,
      mode: best.mode,
      confidence: best.corr,
      samples: this.samples,
    };
  }
}
